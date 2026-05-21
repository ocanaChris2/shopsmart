import { PoolClient } from 'pg';

export interface AuditEventInput {
  tenantId:      string;
  aggregateType: string;
  aggregateId:   string;
  action:        string;
  actorId?:      string | null;
  delta?:        Record<string, unknown>;
  metadata?:     Record<string, unknown>;
}

/**
 * Inserts a single row into audit.events.
 * Must be called within a transaction that has already set
 * `app.current_tenant_id` so RLS allows the insert.
 */
export async function insertAuditEvent(
  db:    PoolClient,
  input: AuditEventInput,
): Promise<void> {
  await db.query(
    `INSERT INTO audit.events
       (tenant_id, aggregate_type, aggregate_id, action,
        actor_id, delta, metadata, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $5)`,
    [
      input.tenantId,
      input.aggregateType,
      input.aggregateId,
      input.action,
      input.actorId ?? null,
      JSON.stringify(input.delta   ?? {}),
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}
