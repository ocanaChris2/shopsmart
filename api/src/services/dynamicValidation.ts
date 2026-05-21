import { PoolClient } from 'pg';
import { z } from 'zod';
import { EntityRow, FieldRow, FieldType, FieldConfig } from '../types';
import { findEntityBySlug, findFieldsByEntityId } from '../repositories/metaRepository';
import { NotFoundError, ValidationError } from '../errors/AppError';

// ── Schema cache ──────────────────────────────────────────────────────────────

interface CacheEntry {
  entity:    EntityRow;
  fields:    FieldRow[];
  schema:    z.ZodObject<z.ZodRawShape>;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

// Key = `${tenantId}:${entitySlug}`
const cache = new Map<string, CacheEntry>();

function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt < now) cache.delete(key);
  }
}

// ── Field-type → Zod mapping ──────────────────────────────────────────────────

function buildZodType(fieldType: FieldType, config: FieldConfig): z.ZodTypeAny {
  switch (fieldType) {
    case 'string': {
      let s = z.string();
      if (config.min_length !== undefined) s = s.min(config.min_length);
      if (config.max_length !== undefined) s = s.max(config.max_length);
      if (config.pattern)                  s = s.regex(new RegExp(config.pattern));
      return s;
    }
    case 'text':
      return z.string();

    case 'number': {
      let n = z.number();
      if (config.min !== undefined) n = n.min(config.min);
      if (config.max !== undefined) n = n.max(config.max);
      return n;
    }
    case 'currency': {
      let c = z.number().nonnegative();
      if (config.min !== undefined) c = c.min(config.min);
      if (config.max !== undefined) c = c.max(config.max);
      return c;
    }

    case 'date':
      return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

    case 'datetime':
      return z.string().datetime({ message: 'Expected ISO-8601 datetime' });

    case 'boolean':
      return z.boolean();

    case 'enum': {
      const opts = config.options?.map((o) => o.value);
      if (opts && opts.length > 0) {
        return z.enum(opts as [string, ...string[]]);
      }
      return z.string();
    }
    case 'multi_enum': {
      const opts = config.options?.map((o) => o.value);
      if (opts && opts.length > 0) {
        return z.array(z.enum(opts as [string, ...string[]]));
      }
      return z.array(z.string());
    }

    case 'reference':
      return z.string().uuid('Expected UUID reference');

    case 'email':
      return z.string().email();

    case 'url':
      return z.string().url();

    case 'phone':
      return z.string().min(7).max(20);

    case 'file':
      return z.string(); // store as URL / file reference key

    default:
      return z.unknown();
  }
}

function buildSchema(fields: FieldRow[]): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {};

  for (const field of fields) {
    let type = buildZodType(field.field_type, field.config);

    // Make the field optional at the Zod level for PATCH (partial update) use;
    // required enforcement is applied in validate() based on the operation.
    type = type.optional();

    shape[field.slug] = type;
  }

  // strict() ensures Zod REJECTS unknown keys (mass-assignment prevention).
  return z.object(shape).strict();
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ValidationResult {
  entity:        EntityRow;
  fields:        FieldRow[];
  validatedData: Record<string, unknown>;
}

/**
 * Validates `payload` against the dynamic schema for `entitySlug`.
 *
 * - Unknown keys cause a 400 (z.object().strict()).
 * - Required field enforcement applies for POST (requireAllFields = true).
 * - For PATCH, all fields are optional but must still pass type rules if present.
 *
 * Results are cached per tenant+entity for 5 minutes to avoid repeated DB calls.
 */
export async function validatePayload(
  db:               PoolClient,
  tenantId:         string,
  entitySlug:       string,
  payload:          unknown,
  requireAllFields: boolean,
): Promise<ValidationResult> {
  evictExpired();

  const cacheKey = `${tenantId}:${entitySlug}`;
  let entry = cache.get(cacheKey);

  if (!entry || entry.expiresAt < Date.now()) {
    const entity = await findEntityBySlug(db, entitySlug);
    if (!entity) throw new NotFoundError(`Entity '${entitySlug}'`);

    const fields = await findFieldsByEntityId(db, entity.id);
    const schema = buildSchema(fields);

    entry = { entity, fields, schema, expiresAt: Date.now() + CACHE_TTL_MS };
    cache.set(cacheKey, entry);
  }

  let schema = entry.schema;

  // For POST: make required fields non-optional at runtime.
  if (requireAllFields) {
    const requiredOverride: z.ZodRawShape = {};
    for (const field of entry.fields) {
      if (field.is_required) {
        requiredOverride[field.slug] = buildZodType(field.field_type, field.config);
      }
    }
    if (Object.keys(requiredOverride).length > 0) {
      schema = schema.extend(requiredOverride).strict() as z.ZodObject<z.ZodRawShape>;
    }
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ValidationError(
      'Payload validation failed',
      result.error.issues,
    );
  }

  // Remove undefined keys (optional fields not provided) from the output.
  const validatedData = Object.fromEntries(
    Object.entries(result.data as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    ),
  );

  return { entity: entry.entity, fields: entry.fields, validatedData };
}

/**
 * Invalidate the cache entry for a tenant+entity (call after schema changes).
 */
export function invalidateCache(tenantId: string, entitySlug: string): void {
  cache.delete(`${tenantId}:${entitySlug}`);
}
