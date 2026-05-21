import PgBoss from 'pg-boss';
import { env }  from '../config/env';

// ── Shared queue constants (copy of worker/src/types/jobs.ts QUEUES) ─────────
// Kept as a local copy to avoid a package dependency between the two services.
export const QUEUES = {
  GENERATE_DYNAMIC_EXPORT:     'generate_dynamic_export',
  PROCESS_ACCOUNTING_REVERSAL: 'process_accounting_reversal',
  DLQ:                         'dlq_failed_jobs',
} as const;

// ── Default send options (must match worker's expected retry config) ──────────
const SEND_DEFAULTS: PgBoss.SendOptions = {
  retryLimit:    3,
  retryDelay:    30,       // seconds; with retryBackoff = true: 30, 60, 120
  retryBackoff:  true,
  expireInHours: 24,
  deadLetter:    QUEUES.DLQ,
};

// ── Lazy singleton ────────────────────────────────────────────────────────────
// pg-boss is initialised once on first use and reused for the lifetime of the
// API process. It is used here as a PRODUCER ONLY — boss.work() is never called
// in the API. The worker process is the sole consumer.

let _boss: PgBoss | null = null;

async function getBoss(): Promise<PgBoss> {
  if (_boss) return _boss;

  _boss = new PgBoss({
    connectionString:  env.DATABASE_URL,
    max:               2,   // tiny pool — API only sends, never polls
    ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    // Disable pg-boss's own scheduling and monitoring loops in the API process.
    // The worker process owns those responsibilities.
    noScheduling: true,
    monitorStateIntervalMinutes: 0,
  });

  _boss.on('error', (err: Error) => {
    console.error('[queue] pg-boss error:', err.message);
  });

  await _boss.start();
  console.info('[queue] pg-boss producer initialised');

  return _boss;
}

export async function stopQueue(): Promise<void> {
  if (_boss) {
    await _boss.stop();
    _boss = null;
  }
}

// ── Typed job payload interfaces (mirrored from worker/src/types/jobs.ts) ────

export interface GenerateDynamicExportPayload {
  tenantId:          string;
  userId:            string;
  entitySlug:        string;
  format:            'csv' | 'pdf';
  filters:           Record<string, unknown>;
  exportJobRecordId: string;
}

export interface ProcessAccountingReversalPayload {
  tenantId:                string;
  userId:                  string;
  journalEntryIdToReverse: string;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Enqueues a `generate_dynamic_export` job.
 *
 * The caller (controller) should first create an ExportJob record in
 * core.records with `data.status = 'pending'`, then pass its ID here.
 * The worker will update that record to 'completed' when done.
 *
 * Returns the pg-boss job ID (UUID) for status polling.
 */
export async function enqueueExport(
  payload: GenerateDynamicExportPayload,
): Promise<string> {
  const boss  = await getBoss();
  const jobId = await boss.send(
    QUEUES.GENERATE_DYNAMIC_EXPORT,
    payload,
    SEND_DEFAULTS,
  );
  if (!jobId) throw new Error('pg-boss returned null job ID — database may be unavailable');
  return jobId;
}

/**
 * Enqueues an `process_accounting_reversal` job.
 *
 * The reversal is fully idempotent: if the same job is submitted twice,
 * the second attempt will throw "already reversed" in the handler and
 * exhaust retries without data corruption.
 */
export async function enqueueAccountingReversal(
  payload: ProcessAccountingReversalPayload,
  options?: Partial<PgBoss.SendOptions>,
): Promise<string> {
  const boss  = await getBoss();
  const jobId = await boss.send(
    QUEUES.PROCESS_ACCOUNTING_REVERSAL,
    payload,
    { ...SEND_DEFAULTS, ...options },
  );
  if (!jobId) throw new Error('pg-boss returned null job ID — database may be unavailable');
  return jobId;
}
