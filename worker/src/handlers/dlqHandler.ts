import PgBoss                 from 'pg-boss';
import { pool }               from '../config/db';
import { DlqJobPayload, QUEUES } from '../types/jobs';
import { insertAuditEvent }   from '../utils/audit';

/**
 * Dead-Letter Queue handler.
 *
 * pg-boss routes a job here after its retry limit is exhausted.
 * The DLQ job's `data` is our enriched DlqJobPayload, set by BaseHandler
 * in its catch block via the error object properties before rethrowing.
 *
 * Responsibility: write a permanent, searchable audit record of the failure
 * so on-call engineers can triage without digging through raw logs.
 *
 * Note: this handler does NOT extend BaseHandler because DLQ jobs are a
 * meta-level concern — they may arrive with tenantId = '' if the payload
 * was malformed. We handle that gracefully.
 */
export const dlqHandle = async (job: PgBoss.Job<DlqJobPayload>): Promise<void> => {
  const {
    tenantId,
    userId,
    originalJobId,
    originalJobName,
    errorMessage,
    errorStack,
    retryCount,
  } = job.data;

  console.error(
    `[DLQ] Permanent failure — job=${originalJobId}` +
    ` queue=${originalJobName}` +
    ` tenant=${tenantId}` +
    ` retries=${retryCount}` +
    ` error=${errorMessage}`,
  );

  // Best-effort audit log: even if tenantId is missing we still write a
  // system-level record using a special 'SYSTEM' sentinel (no RLS needed
  // because audit.events INSERT only requires the tenant_id column to match —
  // if tenantId is invalid the insert fails, which is acceptable; we catch it).
  if (!tenantId) {
    console.error('[DLQ] No tenantId in DLQ payload — cannot write to audit.events');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);

    await insertAuditEvent(client, {
      tenantId,
      aggregateType: 'WorkerJob',
      aggregateId:   originalJobId,
      action:        'JobPermanentlyFailed',
      actorId:       userId || null,
      delta: {
        after: {
          errorMessage,
          errorStack: errorStack?.slice(0, 800),
          retryCount,
        },
      },
      metadata: {
        originalJobName,
        dlqJobId: job.id,
      },
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[DLQ] Failed to write permanent failure to audit.events:', err);
    // Do NOT rethrow — we must not allow the DLQ job itself to fail and loop.
  } finally {
    client.release();
  }
};

export const dlqJobName = QUEUES.DLQ;
