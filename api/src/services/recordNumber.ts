import { PoolClient } from 'pg';

/**
 * Atomically generates the next human-readable record number for a given
 * tenant + entity combination.
 *
 * Uses an INSERT ON CONFLICT DO UPDATE pattern against core.record_sequences,
 * which is a counter table added in db/init.sql. This avoids race conditions
 * under concurrent inserts — the DB serializes the counter increment.
 *
 * Example output: "VEH-00001", "PAT-00042", "CASE-2024-0007"
 */
export async function nextRecordNumber(
  db:       PoolClient,
  tenantId: string,
  entityId: string,
  prefix:   string,
): Promise<string> {
  const result = await db.query<{ next_val: string }>(
    `INSERT INTO core.record_sequences (tenant_id, entity_id, last_value)
     VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, entity_id)
     DO UPDATE SET last_value = core.record_sequences.last_value + 1
     RETURNING last_value AS next_val`,
    [tenantId, entityId],
  );

  const seq = parseInt(result.rows[0]!.next_val, 10);
  const padded = String(seq).padStart(5, '0');
  return `${prefix.toUpperCase()}-${padded}`;
}
