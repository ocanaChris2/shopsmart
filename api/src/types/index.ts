// ── Database row shapes ──────────────────────────────────────────────────────

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  locale: string;
  timezone: string;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  password_hash: string;
  is_active: boolean;
  last_login_at: Date | null;
  failed_login_count: number;
  locked_until: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserTenantRow {
  id: string;
  user_id: string;
  tenant_id: string;
  role: UserRole;
  is_active: boolean;
  joined_at: Date;
}

export interface EntityRow {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  is_system: boolean;
  config: EntityConfig;
  created_at: Date;
  updated_at: Date;
}

export interface EntityConfig {
  record_number_prefix?: string;
  default_sort?: string;
  [key: string]: unknown;
}

export interface FieldRow {
  id: string;
  entity_id: string;
  name: string;
  slug: string;
  field_type: FieldType;
  is_required: boolean;
  is_unique: boolean;
  is_searchable: boolean;
  display_order: number;
  config: FieldConfig;
  created_at: Date;
  updated_at: Date;
}

export type FieldType =
  | 'string' | 'text' | 'number' | 'currency'
  | 'date' | 'datetime' | 'boolean'
  | 'enum' | 'multi_enum' | 'reference'
  | 'file' | 'email' | 'phone' | 'url';

export interface FieldConfig {
  options?: Array<{ label: string; value: string; color?: string }>;
  target_entity_slug?: string;
  display_field?: string;
  min?: number;
  max?: number;
  decimal_places?: number;
  currency?: string;
  min_length?: number;
  max_length?: number;
  pattern?: string;
  [key: string]: unknown;
}

export interface RecordRow {
  id: string;
  tenant_id: string;
  entity_id: string;
  record_number: string;
  data: Record<string, unknown>;
  status: string;
  created_by: string;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
  version: number;
}

export interface AuditDelta {
  before?: Record<string, unknown>;
  after?:  Record<string, unknown>;
}

export interface AuditMetadata {
  ip?:         string;
  user_agent?: string;
  request_id?: string;
  [key: string]: unknown;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export type UserRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface JWTPayload {
  sub:       string;   // user UUID
  email:     string;
  tenant_id: string;
  role:      UserRole;
  iat:       number;
  exp:       number;
}

// ── Service layer ─────────────────────────────────────────────────────────────

export interface ListOptions {
  page:    number;
  limit:   number;
  status?: string;
  filter?: Record<string, unknown>;
}

export interface InsertAuditEventPayload {
  tenant_id:      string;
  aggregate_type: string;
  aggregate_id:   string;
  action:         string;
  actor_id:       string;
  delta:          AuditDelta;
  metadata:       AuditMetadata;
}
