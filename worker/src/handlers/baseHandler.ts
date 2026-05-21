import PgBoss from 'pg-boss';
import { PoolClient } from 'pg';
import { pool }              from '../config/db';
import { BaseJobPayload }    from '../types/jobs';
import { insertAuditEvent }  from '../utils/audit';

// ── Metadata visible to every handler ────────────────────────────────────────

export interface JobMeta {
  jobId:      string;
  retryCount: number;
}

// ── Abstract base class ───────────────────────────────────────────────────────

/**
 * Every job handler extends BaseHandler<T> and implements only `execute`.
 *
 * BaseHandler provides the RLS transaction envelope:
 *   pool.connect()
 *   → BEGIN
 *   → SET LOCAL app.current_tenant_id = <tenantId from payload>
 *   → execute()   ← subclass business logic runs here
 *   → COMMIT
 *   (on any throw → ROLLBACK, log to audit.events, re-throw for pg-boss retries)
 *
 * Security guarantee: if `execute` queries any tenant-scoped table without a
 * WHERE tenant_id clause, Postgres RLS enforces it automatically because the
 * session variable is set before any data access.
 */
export abstract class BaseHandler<T extends BaseJobPayload> {
  /** Must match the pg-boss queue name used when sending the job. */
  abstract readonly jobName: string;

  /**
   * Business logic implementation.
   * Receives a fully-active RLS-scoped `db` client inside an open transaction.
   * Throw any Error to trigger a pg-boss retry (with exponential backoff).
   */
  protected abstract execute(
    db:      PoolClient,
    payload: T,
    meta:    JobMeta,
  ): Promise<void>;

  /**
   * The function pg-boss calls for each job.
   * Declared as an arrow function so `this` is always bound correctly when
   * passed as a callback to `boss.work(name, options, handler.handle)`.
   */
  readonly handle = async (job: PgBoss.Job<T>): Promise<void> => {
    const { tenantId, userId } = job.data;
    const meta: JobMeta = { jobId: job.id, retryCount: job.retrycount ?? 0 };

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // ── RLS enforcement ────────────────────────────────────────────────────
      // SET LOCAL scopes the variable to THIS transaction only.
      // When the client is released, the connection returns to the pool with
      // no tenant context — zero cross-tenant leakage risk.
      await client.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);

      // ── Business logic ─────────────────────────────────────────────────────
      await this.execute(client, job.data, meta);

      await client.query('COMMIT');

      console.info(
        `[${this.jobName}] job=${job.id} tenant=${tenantId} ✓ completed`,
      );
    } catch (rawErr) {
      await client.query('ROLLBACK').catch(() => undefined);

      const err      = rawErr instanceof Error ? rawErr : new Error(String(rawErr));
      const isFinal  = (job.retrycount ?? 0) >= (job.retrylimit ?? 0);

      console.error(
        `[${this.jobName}] job=${job.id} tenant=${tenantId} ✗ failed` +
        ` (attempt ${(job.retrycount ?? 0) + 1}/${(job.retrylimit ?? 0) + 1}):`,
        err.message,
      );

      // Log every failure to audit.events in a separate transaction so the
      // rollback above does not prevent the audit record from being written.
      await this.logFailure(tenantId, userId, meta, err, isFinal);

      // Re-throw so pg-boss marks the job as failed and schedules a retry
      // (or routes it to the DLQ after the retry limit is reached).
      throw err;
    } finally {
      client.release();
    }
  };

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async logFailure(
    tenantId:  string,
    userId:    string,
    meta:      JobMeta,
    err:       Error,
    isFinal:   boolean,
  ): Promise<void> {
    const logClient = await pool.connect();
    try {
      await logClient.query('BEGIN');
      await logClient.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);

      await insertAuditEvent(logClient, {
        tenantId,
        aggregateType: 'WorkerJob',
        aggregateId:   meta.jobId,
        action:        isFinal ? 'JobExhausted' : 'JobAttemptFailed',
        actorId:       userId,
        delta: {
          after: {
            error:      err.message,
            stack:      err.stack?.slice(0, 500),
            retryCount: meta.retryCount,
          },
        },
        metadata: {
          jobName:  this.jobName,
          isFinal,
        },
      });

      await logClient.query('COMMIT');
    } catch (logErr) {
      await logClient.query('ROLLBACK').catch(() => undefined);
      // Do not crash the worker over a logging failure.
      console.error('[BaseHandler] Could not write failure to audit.events:', logErr);
    } finally {
      logClient.release();
    }
  }
}
