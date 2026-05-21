import { PoolClient } from 'pg';
import { EntityRow, FieldRow } from '../types';

/**
 * Fetch a single entity definition by its URL-safe slug.
 * Runs under RLS — will only return rows belonging to the current tenant.
 */
export async function findEntityBySlug(
  db: PoolClient,
  slug: string,
): Promise<EntityRow | null> {
  const result = await db.query<EntityRow>(
    `SELECT id, tenant_id, name, slug, description, icon, color,
            is_system, config, created_at, updated_at
     FROM meta.entities
     WHERE slug = $1`,
    [slug],
  );
  return result.rows[0] ?? null;
}

/**
 * Fetch all field definitions for an entity, ordered for display.
 * No tenant_id filter here — RLS on meta.entities already scopes the parent,
 * and meta.fields RLS policy enforces isolation via the entity_id subquery.
 */
export async function findFieldsByEntityId(
  db: PoolClient,
  entityId: string,
): Promise<FieldRow[]> {
  const result = await db.query<FieldRow>(
    `SELECT id, entity_id, name, slug, field_type,
            is_required, is_unique, is_searchable, display_order, config,
            created_at, updated_at
     FROM meta.fields
     WHERE entity_id = $1
     ORDER BY display_order ASC, created_at ASC`,
    [entityId],
  );
  return result.rows;
}
