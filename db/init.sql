-- =============================================================================
--  SHOPSMART BETA — UNIVERSAL ERP PLATFORM
--  Database Initialization Script
--  PostgreSQL 15+
--
--  Run as superuser against a fresh database:
--    psql -U postgres -d shopsmart -f db/init.sql
--
--  Application transactions must begin with:
--    SET LOCAL app.current_tenant_id = '<tenant-uuid>';
-- =============================================================================

SET client_min_messages = WARNING;
SET statement_timeout    = 0;

-- ---------------------------------------------------------------------------
-- 0.  EXTENSIONS
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), pgp_sym_encrypt
CREATE EXTENSION IF NOT EXISTS btree_gin;  -- composite GIN indexes on JSONB + scalar

-- ---------------------------------------------------------------------------
-- 1.  SCHEMAS
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS meta;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS fin;
CREATE SCHEMA IF NOT EXISTS audit;

COMMENT ON SCHEMA public IS 'Anchor layer: global identity, tenants, role mapping';
COMMENT ON SCHEMA meta   IS 'Metadata engine: runtime entity/field definitions';
COMMENT ON SCHEMA core   IS 'Polymorphic store: all dynamic entity instances via JSONB';
COMMENT ON SCHEMA fin    IS 'Accountability ledger: immutable double-entry journal';
COMMENT ON SCHEMA audit  IS 'Event store: append-only mutation log for compliance and ML';

-- ---------------------------------------------------------------------------
-- 2.  SHARED UTILITY FUNCTIONS
-- ---------------------------------------------------------------------------

-- Reads the current tenant UUID from the session variable set by the application.
-- Returns NULL (not an error) when the variable is absent — safe for admin contexts.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID;
$$;

COMMENT ON FUNCTION public.current_tenant_id() IS
  'Reads app.current_tenant_id session variable. Returns NULL if unset.';

-- Generic trigger: refreshes updated_at on every mutable table.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3.  PUBLIC SCHEMA — Identity & Tenancy Anchor
-- ---------------------------------------------------------------------------

CREATE TABLE public.tenants (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT         NOT NULL,
  slug        TEXT         NOT NULL UNIQUE,
  plan        TEXT         NOT NULL DEFAULT 'starter'
                             CHECK (plan IN ('starter', 'pro', 'enterprise')),
  locale      TEXT         NOT NULL DEFAULT 'en-US',
  timezone    TEXT         NOT NULL DEFAULT 'UTC',
  -- Feature flags, branding, module-enablement bits.
  -- Keys are module slugs; values are module-specific config objects.
  config      JSONB        NOT NULL DEFAULT '{}',
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE  public.tenants        IS 'Root tenant entity. Every data row in the system belongs to a tenant.';
COMMENT ON COLUMN public.tenants.config IS 'Module feature flags and UI preferences, keyed by module slug.';


CREATE TABLE public.users (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT         NOT NULL UNIQUE,
  display_name        TEXT         NOT NULL,
  avatar_url          TEXT,
  -- Application layer produces a strong hash (bcrypt / argon2id) before storage.
  password_hash       TEXT         NOT NULL,
  -- TOTP seed must be encrypted at the application layer before being written here.
  totp_secret_enc     TEXT,
  is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
  last_login_at       TIMESTAMPTZ,
  failed_login_count  INTEGER      NOT NULL DEFAULT 0,
  locked_until        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_users_email ON public.users (email);

COMMENT ON TABLE  public.users                 IS 'Global user identity. One row per human across all tenants.';
COMMENT ON COLUMN public.users.totp_secret_enc IS 'Encrypted TOTP seed. The application layer owns the encryption key.';


-- M:N bridge — a user may belong to multiple tenants with different roles.
CREATE TABLE public.user_tenants (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  tenant_id   UUID         NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role        TEXT         NOT NULL DEFAULT 'member'
                             CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  invited_by  UUID         REFERENCES public.users(id),
  joined_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tenant_id)
);

CREATE INDEX idx_user_tenants_user_id   ON public.user_tenants (user_id);
CREATE INDEX idx_user_tenants_tenant_id ON public.user_tenants (tenant_id);

COMMENT ON TABLE public.user_tenants IS
  'Role-membership bridge. The role column is the single source of truth for RBAC.';

-- ---------------------------------------------------------------------------
-- 4.  META SCHEMA — Dynamic Entity / Field Definitions
-- ---------------------------------------------------------------------------

-- Each row defines a named business-object type scoped to a tenant.
-- Examples: "Vehicle", "Patient", "Legal Case", "Cargo Shipment".
-- No DDL migration is required to add a new entity type.
CREATE TABLE meta.entities (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        TEXT         NOT NULL,
  slug        TEXT         NOT NULL,   -- machine key, e.g. 'vehicle'
  description TEXT,
  icon        TEXT,                    -- icon name / emoji for the UI
  color       TEXT,                    -- hex color for list view theming
  -- TRUE  = seeded by the platform; tenants cannot delete it.
  -- FALSE = created by the tenant; fully ownable.
  is_system   BOOLEAN      NOT NULL DEFAULT FALSE,
  -- UI and generation config.
  -- Example: {"record_number_prefix": "VEH", "default_sort": "created_at:desc"}
  config      JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, slug)
);

CREATE TRIGGER trg_entities_updated_at
  BEFORE UPDATE ON meta.entities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_entities_tenant_id ON meta.entities (tenant_id);

COMMENT ON TABLE  meta.entities           IS 'Runtime schema: each row defines a user-configurable business object type.';
COMMENT ON COLUMN meta.entities.config    IS
  'record_number_prefix drives human-readable IDs in core.records. '
  'default_sort controls list view ordering.';
COMMENT ON COLUMN meta.entities.is_system IS
  'System entities are seeded by the platform and cannot be deleted by tenants.';


-- Each row defines one typed property of an entity.
-- The slug is the key used in core.records.data (JSONB).
CREATE TABLE meta.fields (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      UUID         NOT NULL REFERENCES meta.entities(id) ON DELETE CASCADE,
  name           TEXT         NOT NULL,   -- human label, e.g. 'License Plate'
  slug           TEXT         NOT NULL,   -- JSONB key,  e.g. 'license_plate'
  field_type     TEXT         NOT NULL
    CHECK (field_type IN (
      'string',       -- short free text
      'text',         -- long / rich text
      'number',       -- integer or float
      'currency',     -- decimal with ISO-4217 currency tag
      'date',         -- calendar date (no time component)
      'datetime',     -- ISO-8601 timestamp
      'boolean',      -- true / false toggle
      'enum',         -- single-select from a predefined option list
      'multi_enum',   -- multi-select from a predefined option list
      'reference',    -- soft pointer to another entity's record
      'file',         -- attachment / document reference
      'email',
      'phone',
      'url'
    )),
  is_required    BOOLEAN      NOT NULL DEFAULT FALSE,
  is_unique      BOOLEAN      NOT NULL DEFAULT FALSE,
  is_searchable  BOOLEAN      NOT NULL DEFAULT TRUE,
  display_order  INTEGER      NOT NULL DEFAULT 0,
  -- Field-type-specific validation rules and UI metadata:
  --   enum / multi_enum → {"options": [{"label": "Active", "value": "active", "color": "#22c55e"}]}
  --   reference         → {"target_entity_slug": "customer", "display_field": "full_name"}
  --   number / currency → {"min": 0, "max": 1e9, "decimal_places": 2, "currency": "USD"}
  --   string            → {"min_length": 1, "max_length": 255, "pattern": "^[A-Z]{2}\\d+"}
  config         JSONB        NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, slug)
);

CREATE TRIGGER trg_fields_updated_at
  BEFORE UPDATE ON meta.fields
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_fields_entity_id ON meta.fields (entity_id);

COMMENT ON TABLE  meta.fields       IS 'Typed field definitions for dynamic entities. Each row is a virtual column.';
COMMENT ON COLUMN meta.fields.slug  IS 'Stable lowercase_snake_case key used in core.records.data. Never rename after records exist.';
COMMENT ON COLUMN meta.fields.config IS 'Validation rules and UI metadata. Structure depends on field_type.';

-- ---------------------------------------------------------------------------
-- 5.  CORE SCHEMA — Polymorphic Data Store
-- ---------------------------------------------------------------------------

-- Universal record table. Every instance of every dynamic entity lives here.
-- Query pattern: always filter (tenant_id, entity_id) first via B-tree indexes,
-- then use JSONB operators on `data` accelerated by the GIN index.
CREATE TABLE core.records (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID         NOT NULL REFERENCES public.tenants(id)  ON DELETE RESTRICT,
  entity_id      UUID         NOT NULL REFERENCES meta.entities(id)   ON DELETE RESTRICT,
  -- Human-readable prefixed identifier generated by the application layer.
  -- Prefix comes from meta.entities.config->>'record_number_prefix'.
  -- Examples: 'VEH-00001', 'PAT-00042', 'CASE-2024-0007'
  record_number  TEXT         NOT NULL,
  -- Payload: keys are meta.fields.slug values, values are the field data.
  -- Example: {"license_plate": "ABC-1234", "year": 2023, "fuel_type": "electric"}
  data           JSONB        NOT NULL DEFAULT '{}',
  status         TEXT         NOT NULL DEFAULT 'active',
  created_by     UUID         NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  updated_by     UUID         REFERENCES public.users(id)          ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- Optimistic concurrency lock. Application increments this on every UPDATE
  -- and checks it matches before writing to prevent lost updates.
  version        INTEGER      NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, entity_id, record_number)
);

CREATE TRIGGER trg_records_updated_at
  BEFORE UPDATE ON core.records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_records_tenant_id     ON core.records (tenant_id);
CREATE INDEX idx_records_entity_id     ON core.records (entity_id);
CREATE INDEX idx_records_tenant_entity ON core.records (tenant_id, entity_id);
CREATE INDEX idx_records_status        ON core.records (tenant_id, status);
CREATE INDEX idx_records_created_at    ON core.records (tenant_id, created_at DESC);

-- GIN index: powers arbitrary JSONB queries such as
--   data @> '{"license_plate": "ABC-1234"}'
--   data ? 'blood_type'
CREATE INDEX idx_records_data_gin ON core.records USING GIN (data);

COMMENT ON TABLE  core.records              IS 'Universal entity instance table. Every dynamic business object is a row here.';
COMMENT ON COLUMN core.records.data         IS 'JSONB payload keyed by meta.fields.slug. Never embed tenant_id here — it is a column.';
COMMENT ON COLUMN core.records.version      IS 'Optimistic lock counter. Increment on UPDATE; check before writing.';
COMMENT ON COLUMN core.records.record_number IS 'Human-readable ID generated from entity prefix + sequence by the application layer.';


-- Monotonic per-tenant, per-entity counter for record number generation.
-- The API uses INSERT ON CONFLICT DO UPDATE to increment atomically, making
-- concurrent inserts safe without advisory locks or application-side sequencing.
CREATE TABLE core.record_sequences (
  tenant_id  UUID    NOT NULL REFERENCES public.tenants(id)  ON DELETE CASCADE,
  entity_id  UUID    NOT NULL REFERENCES meta.entities(id)   ON DELETE CASCADE,
  last_value BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, entity_id)
);

ALTER TABLE core.record_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.record_sequences FORCE  ROW LEVEL SECURITY;

CREATE POLICY rls_record_sequences_tenant ON core.record_sequences
  AS PERMISSIVE FOR ALL
  USING      (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

COMMENT ON TABLE core.record_sequences IS
  'Atomic per-entity sequence counters. Incremented by the API via INSERT ON CONFLICT.';

-- ---------------------------------------------------------------------------
-- 6.  FIN SCHEMA — Immutable Double-Entry Financial Ledger
-- ---------------------------------------------------------------------------

-- Hierarchical Chart of Accounts per tenant.
CREATE TABLE fin.accounts (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID         NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  parent_id       UUID         REFERENCES fin.accounts(id),   -- NULL = root account
  code            TEXT         NOT NULL,   -- e.g. '1010', '2000', '4100'
  name            TEXT         NOT NULL,
  account_type    TEXT         NOT NULL
    CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  -- Which side of the ledger increases this account's balance.
  normal_balance  TEXT         NOT NULL
    CHECK (normal_balance IN ('debit', 'credit')),
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  description     TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

CREATE TRIGGER trg_accounts_updated_at
  BEFORE UPDATE ON fin.accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_accounts_tenant_id ON fin.accounts (tenant_id);
CREATE INDEX idx_accounts_parent_id ON fin.accounts (parent_id);

COMMENT ON TABLE fin.accounts IS
  'Hierarchical Chart of Accounts. Each tenant owns its own account tree.';


-- Immutable transaction header.
-- Once status = 'posted': no UPDATE, no DELETE — ever.
-- Corrections are achieved by posting a new reversal entry.
CREATE TABLE fin.journal_entries (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  entry_number  TEXT         NOT NULL,   -- e.g. 'JE-2024-00001'
  -- The system or workflow that originated this entry.
  -- Examples: 'MANUAL', 'INVOICE', 'PAYMENT', 'PAYROLL', 'EXPENSE', 'REVERSAL'
  source_type   TEXT         NOT NULL,
  -- UUID of the originating document in core.records or a module table (polymorphic).
  source_id     UUID,
  description   TEXT         NOT NULL,
  entry_date    DATE         NOT NULL DEFAULT CURRENT_DATE,
  is_reversal   BOOLEAN      NOT NULL DEFAULT FALSE,
  reversal_of   UUID         REFERENCES fin.journal_entries(id),  -- this entry reverses that one
  reversed_by   UUID         REFERENCES fin.journal_entries(id),  -- that entry reverses this one
  status        TEXT         NOT NULL DEFAULT 'posted'
    CHECK (status IN ('draft', 'posted', 'reversed')),
  created_by    UUID         NOT NULL REFERENCES public.users(id),
  -- No updated_at: this record is intentionally immutable once posted.
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, entry_number)
);

CREATE INDEX idx_je_tenant_id  ON fin.journal_entries (tenant_id);
CREATE INDEX idx_je_entry_date ON fin.journal_entries (tenant_id, entry_date DESC);
CREATE INDEX idx_je_source     ON fin.journal_entries (tenant_id, source_type, source_id);
CREATE INDEX idx_je_status     ON fin.journal_entries (tenant_id, status);

COMMENT ON TABLE fin.journal_entries IS
  'Immutable transaction header. No UPDATE or DELETE once posted. Use reversal entries to correct.';


-- Immutable debit/credit lines. Append-only after INSERT.
CREATE TABLE fin.journal_entry_lines (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID          NOT NULL REFERENCES public.tenants(id)       ON DELETE RESTRICT,
  journal_entry_id UUID          NOT NULL REFERENCES fin.journal_entries(id)  ON DELETE RESTRICT,
  account_id       UUID          NOT NULL REFERENCES fin.accounts(id)         ON DELETE RESTRICT,
  debit            NUMERIC(19,4) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit           NUMERIC(19,4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  -- Each line is EITHER a debit OR a credit, never both and never neither.
  CONSTRAINT chk_debit_xor_credit
    CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
  description      TEXT,
  -- No updated_at: intentionally immutable after INSERT.
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jel_tenant_id  ON fin.journal_entry_lines (tenant_id);
CREATE INDEX idx_jel_entry_id   ON fin.journal_entry_lines (journal_entry_id);
CREATE INDEX idx_jel_account_id ON fin.journal_entry_lines (account_id);

COMMENT ON TABLE fin.journal_entry_lines IS
  'Debit/credit lines. Append-only. Balance enforced by trg_assert_je_balanced.';


-- ── Trigger: double-entry balance enforcement ─────────────────────────────────
-- DEFERRABLE INITIALLY DEFERRED fires at COMMIT, not per-row, so all lines
-- for an entry can be inserted within one transaction before the check runs.
CREATE OR REPLACE FUNCTION fin.assert_journal_entry_balanced()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id UUID;
  v_debits   NUMERIC(19,4);
  v_credits  NUMERIC(19,4);
BEGIN
  v_entry_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);

  SELECT
    COALESCE(SUM(debit),  0),
    COALESCE(SUM(credit), 0)
  INTO v_debits, v_credits
  FROM fin.journal_entry_lines
  WHERE journal_entry_id = v_entry_id;

  IF v_debits <> v_credits THEN
    RAISE EXCEPTION
      'Journal entry % is unbalanced — debits: % | credits: %. '
      'SUM(debit) must equal SUM(credit) within the same entry.',
      v_entry_id, v_debits, v_credits
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_assert_je_balanced
  AFTER INSERT OR UPDATE OR DELETE ON fin.journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION fin.assert_journal_entry_balanced();


-- ── Trigger: immutability guard — journal entries ─────────────────────────────
-- Permits only two status transitions on posted entries:
--   draft   → posted   (publishing a draft)
--   posted  → reversed (stamping a reversal has been created)
-- All other UPDATEs and all DELETEs are rejected.
CREATE OR REPLACE FUNCTION fin.guard_journal_entry_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION
        'Posted journal entry % is immutable. Create a reversal entry instead.', OLD.id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: allow only the two valid status transitions.
  IF OLD.status = 'draft'   AND NEW.status = 'posted'   THEN RETURN NEW; END IF;
  IF OLD.status = 'posted'  AND NEW.status = 'reversed' THEN RETURN NEW; END IF;

  RAISE EXCEPTION
    'Journal entry % is immutable after posting. '
    'Only status transitions (draft→posted, posted→reversed) are permitted.', OLD.id
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER trg_guard_je_immutability
  BEFORE UPDATE OR DELETE ON fin.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION fin.guard_journal_entry_immutability();


-- ── Trigger: immutability guard — journal entry lines ─────────────────────────
CREATE OR REPLACE FUNCTION fin.guard_journal_entry_lines_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Journal entry lines are immutable and cannot be modified or deleted. '
    'To correct entry %, void it with a reversal entry and post corrected lines.',
    OLD.journal_entry_id
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER trg_guard_jel_immutability
  BEFORE UPDATE OR DELETE ON fin.journal_entry_lines
  FOR EACH ROW
  EXECUTE FUNCTION fin.guard_journal_entry_lines_immutability();

-- ---------------------------------------------------------------------------
-- 7.  AUDIT SCHEMA — Append-Only Event Store
-- ---------------------------------------------------------------------------

-- Every significant mutation in the platform is recorded as an immutable event.
-- This table powers:
--   - Regulatory audit trails (GDPR, SOX, HIPAA)
--   - Temporal debugging and full object history replay
--   - ML/AI feature pipelines (behavior sequences, anomaly detection)
--   - Real-time CDC-based event streaming to data lakes and feature stores
CREATE TABLE audit.events (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID         NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  -- Domain object type that changed. PascalCase noun.
  -- Examples: 'Record', 'JournalEntry', 'User', 'Field', 'Account'
  aggregate_type  TEXT         NOT NULL,
  -- UUID of the specific object instance that changed.
  aggregate_id    UUID         NOT NULL,
  -- Past-tense PascalCase verb describing the domain event.
  -- Examples: 'RecordCreated', 'FieldUpdated', 'UserDeactivated',
  --           'JournalEntryPosted', 'RecordStatusChanged'
  action          TEXT         NOT NULL,
  -- User who triggered the action. NULL for system / background jobs.
  actor_id        UUID         REFERENCES public.users(id),
  -- Structured diff capturing state before and after the mutation.
  --   Create  → {"after":  { ...full initial state... }}
  --   Update  → {"before": { ...changed fields only... }, "after": { ...new values... }}
  --   Delete  → {"before": { ...last known state... }}
  delta           JSONB        NOT NULL DEFAULT '{}',
  -- HTTP/network context captured at the moment of the action.
  -- Example: {"ip": "203.0.113.5", "user_agent": "...", "request_id": "req_01HX...", "session_id": "ses_01HY..."}
  metadata        JSONB        NOT NULL DEFAULT '{}',
  -- May differ from actor_id in service-account-on-behalf-of-user scenarios.
  created_by      UUID         REFERENCES public.users(id),
  -- Append-only: no updated_at, no deleted_at, ever.
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Optimized for the two primary access patterns:
--   1. Object timeline:  WHERE tenant_id = ? AND aggregate_type = ? AND aggregate_id = ? ORDER BY created_at
--   2. Actor audit:      WHERE tenant_id = ? AND actor_id = ? ORDER BY created_at
CREATE INDEX idx_events_tenant_id    ON audit.events (tenant_id);
CREATE INDEX idx_events_aggregate    ON audit.events (tenant_id, aggregate_type, aggregate_id);
CREATE INDEX idx_events_action       ON audit.events (tenant_id, action);
CREATE INDEX idx_events_actor        ON audit.events (actor_id);
CREATE INDEX idx_events_created_at   ON audit.events (tenant_id, created_at DESC);

-- GIN indexes for ML feature extraction via JSONB containment queries.
CREATE INDEX idx_events_delta_gin    ON audit.events USING GIN (delta);
CREATE INDEX idx_events_metadata_gin ON audit.events USING GIN (metadata);

COMMENT ON TABLE  audit.events               IS 'Append-only event store. Every domain mutation is a row here.';
COMMENT ON COLUMN audit.events.aggregate_type IS 'Domain object type (PascalCase noun).';
COMMENT ON COLUMN audit.events.action         IS 'Domain event name (PastTense PascalCase verb).';
COMMENT ON COLUMN audit.events.delta          IS 'Structured diff: {"before": {...}, "after": {...}}.';
COMMENT ON COLUMN audit.events.metadata       IS 'Request context: ip, user_agent, request_id, session_id.';


-- ── Trigger: immutability guard — audit events ────────────────────────────────
CREATE OR REPLACE FUNCTION audit.guard_event_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Audit events are immutable and cannot be modified or deleted. '
    'Tamper attempts are logged at the infrastructure layer.'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER trg_guard_audit_immutability
  BEFORE UPDATE OR DELETE ON audit.events
  FOR EACH ROW
  EXECUTE FUNCTION audit.guard_event_immutability();

-- ---------------------------------------------------------------------------
-- 8.  ROW-LEVEL SECURITY (RLS)
-- ---------------------------------------------------------------------------
-- Pattern applied uniformly to every data-bearing table:
--
--   ENABLE RLS  — activates the RLS subsystem for the table.
--   FORCE  RLS  — subjects the table owner (service role) to policies too,
--                 preventing accidental cross-tenant reads in background jobs.
--
-- A single PERMISSIVE policy covers all operations on each table:
--   USING      → row-visibility filter for SELECT / UPDATE / DELETE
--   WITH CHECK → write-guard filter for INSERT / UPDATE
--
-- The application MUST execute at the start of every transaction:
--   SET LOCAL app.current_tenant_id = '<uuid>';
-- ---------------------------------------------------------------------------

-- ── meta.entities ─────────────────────────────────────────────────────────────
ALTER TABLE meta.entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta.entities FORCE  ROW LEVEL SECURITY;

CREATE POLICY rls_entities_tenant ON meta.entities
  AS PERMISSIVE FOR ALL
  USING      (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ── meta.fields ───────────────────────────────────────────────────────────────
-- meta.fields has no tenant_id column; isolation is via parent entity subquery.
-- The idx_entities_tenant_id index makes this subquery efficient.
ALTER TABLE meta.fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta.fields FORCE  ROW LEVEL SECURITY;

CREATE POLICY rls_fields_tenant ON meta.fields
  AS PERMISSIVE FOR ALL
  USING (
    entity_id IN (
      SELECT id FROM meta.entities
       WHERE tenant_id = public.current_tenant_id()
    )
  )
  WITH CHECK (
    entity_id IN (
      SELECT id FROM meta.entities
       WHERE tenant_id = public.current_tenant_id()
    )
  );

-- ── core.records ──────────────────────────────────────────────────────────────
ALTER TABLE core.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.records FORCE  ROW LEVEL SECURITY;

CREATE POLICY rls_records_tenant ON core.records
  AS PERMISSIVE FOR ALL
  USING      (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ── fin.accounts ──────────────────────────────────────────────────────────────
ALTER TABLE fin.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.accounts FORCE  ROW LEVEL SECURITY;

CREATE POLICY rls_accounts_tenant ON fin.accounts
  AS PERMISSIVE FOR ALL
  USING      (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ── fin.journal_entries ───────────────────────────────────────────────────────
ALTER TABLE fin.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.journal_entries FORCE  ROW LEVEL SECURITY;

CREATE POLICY rls_je_tenant ON fin.journal_entries
  AS PERMISSIVE FOR ALL
  USING      (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ── fin.journal_entry_lines ───────────────────────────────────────────────────
ALTER TABLE fin.journal_entry_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.journal_entry_lines FORCE  ROW LEVEL SECURITY;

CREATE POLICY rls_jel_tenant ON fin.journal_entry_lines
  AS PERMISSIVE FOR ALL
  USING      (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ── audit.events ──────────────────────────────────────────────────────────────
ALTER TABLE audit.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.events FORCE  ROW LEVEL SECURITY;

CREATE POLICY rls_events_tenant ON audit.events
  AS PERMISSIVE FOR ALL
  USING      (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- 9.  APPLICATION SERVICE ROLE — Minimal Privilege Grant Template
-- ---------------------------------------------------------------------------
-- Uncomment and replace 'app_service' with the actual DB role name.
-- Execute this block separately as a superuser after the role is created.
-- ---------------------------------------------------------------------------

/*
GRANT USAGE ON SCHEMA meta, core, fin, audit TO app_service;

GRANT SELECT, INSERT, UPDATE         ON ALL TABLES IN SCHEMA meta   TO app_service;
GRANT SELECT, INSERT, UPDATE         ON ALL TABLES IN SCHEMA core   TO app_service;
GRANT SELECT, INSERT                 ON ALL TABLES IN SCHEMA fin    TO app_service;
GRANT SELECT, INSERT                 ON ALL TABLES IN SCHEMA audit  TO app_service;
GRANT SELECT, INSERT, UPDATE         ON public.tenants, public.users, public.user_tenants TO app_service;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA core TO app_service;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA fin  TO app_service;
*/

-- =============================================================================
--  END OF INITIALIZATION SCRIPT
-- =============================================================================
