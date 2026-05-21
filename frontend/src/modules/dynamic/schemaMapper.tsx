/**
 * Schema Mapper — The Bridge Between Backend Metadata and React Components
 *
 * Maps every `field_type` value from meta.fields to:
 *   1. A React component for form rendering (form component).
 *   2. A cell renderer function for table display.
 *
 * Adding a new field type requires only:
 *   a) A new component below.
 *   b) An entry in FORM_RENDERERS and CELL_RENDERERS.
 */
import React from 'react';
import type { ControllerRenderProps } from 'react-hook-form';
import { format } from 'date-fns';
import { Check, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Input }    from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch }   from '@/components/ui/switch';
import { Badge }    from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

import { apiClient }               from '@/services/apiClient';
import { queryKeys, SCHEMA_STALE_TIME, SCHEMA_GC_TIME } from '@/services/queryClient';
import type { FieldDefinition, FieldType, PaginatedResponse, RecordRow } from './types';

// ── Shared props every form renderer receives ─────────────────────────────────

export interface FormRendererProps {
  field:     FieldDefinition;
  formField: ControllerRenderProps;
  disabled?: boolean;
}

// ── Form renderers ────────────────────────────────────────────────────────────

function StringField({ field, formField, disabled }: FormRendererProps) {
  return (
    <Input
      {...formField}
      type="text"
      disabled={disabled}
      placeholder={field.config.pattern ? `Pattern: ${field.config.pattern}` : field.name}
      maxLength={field.config.max_length}
      value={String(formField.value ?? '')}
    />
  );
}

function TextAreaField({ field, formField, disabled }: FormRendererProps) {
  return (
    <Textarea
      {...formField}
      disabled={disabled}
      placeholder={field.name}
      rows={4}
      value={String(formField.value ?? '')}
    />
  );
}

function NumberField({ field, formField, disabled }: FormRendererProps) {
  return (
    <Input
      {...formField}
      type="number"
      disabled={disabled}
      min={field.config.min}
      max={field.config.max}
      step={field.config.decimal_places ? Math.pow(10, -field.config.decimal_places) : 1}
      value={String(formField.value ?? '')}
      onChange={(e) => formField.onChange(e.target.value === '' ? '' : Number(e.target.value))}
    />
  );
}

function CurrencyField({ field, formField, disabled }: FormRendererProps) {
  const symbol = field.config.currency ?? '$';
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
        {symbol}
      </span>
      <Input
        {...formField}
        type="number"
        disabled={disabled}
        min={field.config.min ?? 0}
        step="0.01"
        className="pl-7"
        value={String(formField.value ?? '')}
        onChange={(e) => formField.onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    </div>
  );
}

function DateField({ formField, disabled }: FormRendererProps) {
  const value = formField.value ? String(formField.value).slice(0, 10) : '';
  return (
    <Input
      {...formField}
      type="date"
      disabled={disabled}
      value={value}
    />
  );
}

function DateTimeField({ formField, disabled }: FormRendererProps) {
  const value = formField.value
    ? String(formField.value).slice(0, 16)
    : '';
  return (
    <Input
      {...formField}
      type="datetime-local"
      disabled={disabled}
      value={value}
    />
  );
}

function BooleanField({ field, formField, disabled }: FormRendererProps) {
  return (
    <div className="flex items-center gap-2">
      <Switch
        id={field.slug}
        checked={Boolean(formField.value)}
        onCheckedChange={formField.onChange}
        disabled={disabled}
      />
      <label htmlFor={field.slug} className="text-sm text-muted-foreground cursor-pointer">
        {Boolean(formField.value) ? 'Yes' : 'No'}
      </label>
    </div>
  );
}

function EnumField({ field, formField, disabled }: FormRendererProps) {
  const options = field.config.options ?? [];
  return (
    <Select
      value={String(formField.value ?? '')}
      onValueChange={formField.onChange}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue placeholder={`Select ${field.name}…`} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EmailField({ field, formField, disabled }: FormRendererProps) {
  return (
    <Input
      {...formField}
      type="email"
      disabled={disabled}
      placeholder={`${field.name}@example.com`}
      value={String(formField.value ?? '')}
    />
  );
}

function UrlField({ field, formField, disabled }: FormRendererProps) {
  return (
    <Input
      {...formField}
      type="url"
      disabled={disabled}
      placeholder="https://"
      value={String(formField.value ?? '')}
    />
  );
}

function PhoneField({ formField, disabled }: FormRendererProps) {
  return (
    <Input
      {...formField}
      type="tel"
      disabled={disabled}
      placeholder="+1 (555) 000-0000"
      value={String(formField.value ?? '')}
    />
  );
}

/**
 * Reference field: async-loads records from the target entity endpoint.
 * This IS a React component so it can call hooks safely.
 */
function ReferenceField({ field, formField, disabled }: FormRendererProps) {
  const targetSlug = field.config.target_entity_slug ?? '';
  const displayKey = field.config.display_field ?? 'name';

  const { data, isLoading } = useQuery<PaginatedResponse<RecordRow>>({
    queryKey:  queryKeys.records(targetSlug, { limit: 100 }),
    queryFn:   () =>
      apiClient
        .get<PaginatedResponse<RecordRow>>(`/api/v1/data/${targetSlug}`, { params: { limit: 100 } })
        .then((r) => r.data),
    enabled:   !!targetSlug,
    staleTime: SCHEMA_STALE_TIME,
    gcTime:    SCHEMA_GC_TIME,
  });

  const records = data?.data ?? [];

  return (
    <Select
      value={String(formField.value ?? '')}
      onValueChange={formField.onChange}
      disabled={disabled || isLoading}
    >
      <SelectTrigger>
        <SelectValue placeholder={isLoading ? 'Loading…' : `Select ${field.name}…`} />
      </SelectTrigger>
      <SelectContent>
        {records.map((rec) => (
          <SelectItem key={rec.id} value={rec.id}>
            {String(rec.data[displayKey] ?? rec.record_number)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Form renderer registry ────────────────────────────────────────────────────

const FORM_RENDERERS: Record<FieldType, React.ComponentType<FormRendererProps>> = {
  string:     StringField,
  text:       TextAreaField,
  number:     NumberField,
  currency:   CurrencyField,
  date:       DateField,
  datetime:   DateTimeField,
  boolean:    BooleanField,
  enum:       EnumField,
  multi_enum: EnumField,    // simplified — upgrade to MultiSelect for multi-select
  reference:  ReferenceField,
  email:      EmailField,
  url:        UrlField,
  phone:      PhoneField,
  file:       StringField,  // file upload UI can replace this
};

export function getFormRenderer(
  type: FieldType,
): React.ComponentType<FormRendererProps> {
  return FORM_RENDERERS[type] ?? StringField;
}

// ── Cell renderers (for DynamicTable) ────────────────────────────────────────

export function renderCellValue(
  value:  unknown,
  field:  FieldDefinition,
): React.ReactNode {
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground">—</span>;

  switch (field.field_type) {
    case 'boolean':
      return value
        ? <Check className="h-4 w-4 text-green-500" />
        : <X     className="h-4 w-4 text-red-400" />;

    case 'date':
      try { return format(new Date(String(value)), 'PP'); }
      catch { return String(value); }

    case 'datetime':
      try { return format(new Date(String(value)), 'PPp'); }
      catch { return String(value); }

    case 'currency': {
      const symbol = field.config.currency ?? '$';
      const dp     = field.config.decimal_places ?? 2;
      return `${symbol}${Number(value).toFixed(dp)}`;
    }

    case 'enum': {
      const opt = field.config.options?.find((o) => o.value === value);
      if (!opt) return String(value);
      return (
        <Badge
          style={opt.color ? { backgroundColor: opt.color, color: '#fff' } : undefined}
          variant="secondary"
        >
          {opt.label}
        </Badge>
      );
    }

    case 'multi_enum': {
      const values = Array.isArray(value) ? value : [value];
      return (
        <div className="flex flex-wrap gap-1">
          {values.map((v) => {
            const opt = field.config.options?.find((o) => o.value === v);
            return (
              <Badge key={String(v)} variant="outline">
                {opt?.label ?? String(v)}
              </Badge>
            );
          })}
        </div>
      );
    }

    case 'url':
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:no-underline"
          onClick={(e) => e.stopPropagation()}
        >
          {String(value)}
        </a>
      );

    default:
      return String(value);
  }
}
