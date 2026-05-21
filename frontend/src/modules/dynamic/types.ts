// ── Field types (mirrors backend meta.fields.field_type) ─────────────────────

export type FieldType =
  | 'string' | 'text' | 'number' | 'currency'
  | 'date'   | 'datetime' | 'boolean'
  | 'enum'   | 'multi_enum' | 'reference'
  | 'file'   | 'email' | 'phone' | 'url';

// ── Field-type-specific config (mirrors backend meta.fields.config JSONB) ────

export interface FieldConfig {
  options?:            Array<{ label: string; value: string; color?: string }>;
  target_entity_slug?: string;   // reference field: which entity to look up
  display_field?:      string;   // reference field: which data key to show as label
  min?:                number;
  max?:                number;
  decimal_places?:     number;
  currency?:           string;
  min_length?:         number;
  max_length?:         number;
  pattern?:            string;
}

// ── Core definitions ─────────────────────────────────────────────────────────

export interface FieldDefinition {
  id:            string;
  entity_id:     string;
  name:          string;
  slug:          string;  // key in core.records.data JSONB
  field_type:    FieldType;
  is_required:   boolean;
  is_unique:     boolean;
  is_searchable: boolean;
  display_order: number;
  config:        FieldConfig;
}

export interface EntityDefinition {
  id:          string;
  name:        string;
  slug:        string;
  description: string | null;
  icon:        string | null;
  color:       string | null;
  config: {
    record_number_prefix?: string;
    default_sort?:         string;
    [key: string]: unknown;
  };
}

export interface EntitySchema {
  entity: EntityDefinition;
  fields: FieldDefinition[];
}

// ── Record (core.records row) ─────────────────────────────────────────────────

export interface RecordRow {
  id:           string;
  tenant_id:    string;
  entity_id:    string;
  record_number: string;
  data:         Record<string, unknown>;  // JSONB payload
  status:       string;
  created_by:   string;
  updated_by:   string | null;
  created_at:   string;
  updated_at:   string;
  version:      number;
}

// ── Paginated API response ────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page:  number;
    limit: number;
    pages: number;
  };
}

// ── Query params for list endpoints ──────────────────────────────────────────

export interface RecordQueryParams {
  page?:   number;
  limit?:  number;
  status?: string;
  filter?: Record<string, unknown>;
}
