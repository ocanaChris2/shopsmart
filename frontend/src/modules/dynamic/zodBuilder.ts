import { z } from 'zod';
import type { FieldDefinition, FieldConfig, FieldType } from './types';

// ── Per-type base schema builders ─────────────────────────────────────────────

function stringSchema(config: FieldConfig): z.ZodString {
  let s = z.string();
  if (config.min_length) s = s.min(config.min_length, `Minimum ${config.min_length} characters`);
  if (config.max_length) s = s.max(config.max_length, `Maximum ${config.max_length} characters`);
  if (config.pattern)    s = s.regex(new RegExp(config.pattern), 'Invalid format');
  return s;
}

function numericSchema(config: FieldConfig): z.ZodNumber {
  let n = z.coerce.number({ invalid_type_error: 'Must be a number' });
  if (config.min !== undefined) n = n.min(config.min, `Minimum value is ${config.min}`);
  if (config.max !== undefined) n = n.max(config.max, `Maximum value is ${config.max}`);
  return n;
}

function enumSchema(config: FieldConfig): z.ZodTypeAny {
  const values = config.options?.map((o) => o.value) ?? [];
  if (values.length === 0) return z.string();
  return z.enum(values as [string, ...string[]]);
}

function multiEnumSchema(config: FieldConfig): z.ZodTypeAny {
  const values = config.options?.map((o) => o.value) ?? [];
  if (values.length === 0) return z.array(z.string());
  return z.array(z.enum(values as [string, ...string[]]));
}

// ── Core builder ──────────────────────────────────────────────────────────────

function buildBaseType(fieldType: FieldType, config: FieldConfig): z.ZodTypeAny {
  switch (fieldType) {
    case 'string':    return stringSchema(config);
    case 'text':      return z.string();
    case 'email':     return z.string().email('Invalid email address');
    case 'url':       return z.string().url('Invalid URL');
    case 'phone':     return z.string().min(7, 'Too short').max(20, 'Too long');
    case 'number':    return numericSchema(config);
    case 'currency':  return numericSchema({ ...config, min: config.min ?? 0 });
    case 'date':      return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
    case 'datetime':  return z.string().datetime({ message: 'Expected ISO-8601 datetime' });
    case 'boolean':   return z.boolean();
    case 'enum':      return enumSchema(config);
    case 'multi_enum': return multiEnumSchema(config);
    case 'reference': return z.string().uuid('Must select a valid reference');
    case 'file':      return z.string(); // URL / storage key
    default:          return z.unknown();
  }
}

// ── Public: build a ZodObject from an array of FieldDefinitions ───────────────

/**
 * Dynamically builds a Zod validation schema from the API's meta.fields list.
 *
 * - Required fields: their type is used as-is (e.g. z.string().min(1)).
 * - Optional fields: wrapped in .optional() so undefined passes validation.
 *
 * The returned schema uses z.object().passthrough() so that system-level
 * fields (id, version, etc.) from pre-populated default values are not stripped
 * before the form submits.
 */
export function buildZodSchema(
  fields: FieldDefinition[],
): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {};

  for (const field of fields) {
    let type = buildBaseType(field.field_type, field.config);

    if (field.is_required) {
      // String fields: also enforce non-empty when required.
      if (['string', 'text', 'email', 'url', 'phone'].includes(field.field_type)) {
        type = (type as z.ZodString).min(1, `${field.name} is required`);
      }
    } else {
      type = type.optional();
    }

    shape[field.slug] = type;
  }

  return z.object(shape);
}

// ── Default values builder ────────────────────────────────────────────────────

/**
 * Produces React Hook Form-compatible default values from field definitions.
 * For editing: pass `existingData` to pre-fill the form.
 */
export function buildDefaultValues(
  fields:       FieldDefinition[],
  existingData?: Record<string, unknown>,
): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((acc, field) => {
    const existing = existingData?.[field.slug];
    if (existing !== undefined) {
      acc[field.slug] = existing;
      return acc;
    }

    // Type-appropriate empty defaults so form inputs are "controlled"
    switch (field.field_type) {
      case 'boolean':   acc[field.slug] = false;  break;
      case 'multi_enum': acc[field.slug] = [];    break;
      default:          acc[field.slug] = '';     break;
    }
    return acc;
  }, {});
}
