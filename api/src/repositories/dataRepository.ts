import { PoolClient } from 'pg';
import { RecordRow, ListOptions, InsertAuditEventPayload } from '../types';

// ── core.records ──────────────────────────────────────────────────────────────

export interface ListResult {
  rows:  RecordRow[];
  total: number;
}

export async function listRecords(
  db:       PoolClient,
  entityId: string,
  opts:     ListOptions,
): Promise<ListResult> {
  const { page, limit, status, filter } = opts;
  const offset = (page - 1) * limit;

  // Build the WHERE clause safely; parameters are positional to prevent injection.
  const conditions: string[]  = ['r.entity_id = $1'];
  const params:     unknown[] = [entityId];
  let   idx = 2;

  if (status) {
    conditions.push(`r.status = $${idx++}`);
    params.push(status);
  }

  if (filter && Object.keys(filter).length > 0) {
    // JSONB containment: data @> '{"key": "value"}'
    conditions.push(`r.data @> $${idx++}::jsonb`);
    params.push(JSON.stringify(filter));
  }

  const where = conditions.join(' AND ');

  // Single round trip: data + total count via window function.
  const result = await db.query<RecordRow & { total_count: string }>(
    `SELECT
       r.id, r.tenant_id, r.entity_id, r.record_number,
       r.data, r.status, r.created_by, r.updated_by,
       r.created_at, r.updated_at, r.version,
       COUNT(*) OVER() AS total_count
     FROM core.records r
     WHERE ${where}
     ORDER BY r.created_at DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    [...params, limit, offset],
  );

  return {
    rows:  result.rows,
    total: result.rows[0] ? parseInt(result.rows[0].total_count, 10) : 0,
  };
}

export async function findRecordById(
  db: PoolClient,
  id: string,
): Promise<RecordRow | null> {
  const result = await db.query<RecordRow>(
    `SELECT id, tenant_id, entity_id, record_number,
            data, status, created_by, updated_by,
            created_at, updated_at, version
     FROM core.records
     WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function insertRecord(
  db:           PoolClient,
  tenantId:     string,
  entityId:     string,
  recordNumber: string,
  data:         Record<string, unknown>,
  createdBy:    string,
): Promise<RecordRow> {
  const result = await db.query<RecordRow>(
    `INSERT INTO core.records
       (tenant_id, entity_id, record_number, data, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING *`,
    [tenantId, entityId, recordNumber, JSON.stringify(data), createdBy],
  );
  return result.rows[0]!;
}

export interface UpdateRecordResult {
  record:  RecordRow;
  oldData: Record<string, unknown>;
}

/**
 * Atomically merge `patch` into the record's JSONB `data` column and return
 * both the updated row and the old `data` for delta computation.
 *
 * Uses a CTE so old_data and the UPDATE happen in one round trip.
 * Version mismatch (optimistic lock) returns null — caller decides 404 vs 409.
 */
export async function updateRecord(
  db:              PoolClient,
  id:              string,
  patch:           Record<string, unknown>,
  updatedBy:       string,
  expectedVersion: number,
): Promise<UpdateRecordResult | null> {
  const result = await db.query<RecordRow & { old_data: Record<string, unknown> }>(
    `WITH locked AS (
       SELECT data AS old_data
       FROM core.records
       WHERE id = $1 AND version = $2
       FOR UPDATE
     ),
     updated AS (
       UPDATE core.records
       SET
         data       = core.records.data || $3::jsonb,
         updated_by = $4,
         version    = core.records.version + 1,
         updated_at = NOW()
       FROM locked
       WHERE core.records.id = $1
       RETURNING core.records.*, locked.old_data
     )
     SELECT * FROM updated`,
    [id, expectedVersion, JSON.stringify(patch), updatedBy],
  );

  if ((result.rowCount ?? 0) === 0) return null;

  const row = result.rows[0]!;
  return {
    record:  row,
    oldData: row.old_data,
  };
}

// ── audit.events ──────────────────────────────────────────────────────────────

export async function insertAuditEvent(
  db:      PoolClient,
  payload: InsertAuditEventPayload,
): Promise<void> {
  await db.query(
    `INSERT INTO audit.events
       (tenant_id, aggregate_type, aggregate_id, action,
        actor_id, delta, metadata, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $5)`,
    [
      payload.tenant_id,
      payload.aggregate_type,
      payload.aggregate_id,
      payload.action,
      payload.actor_id,
      JSON.stringify(payload.delta),
      JSON.stringify(payload.metadata),
    ],
  );
}
