import PgBoss             from 'pg-boss';
import { env }            from './config/env';
import { handlers }       from './handlers';
import { dlqHandle, dlqJobName } from './handlers/dlqHandler';

// ── pg-boss work options applied to every job queue ──────────────────────────
const WORK_OPTIONS: PgBoss.WorkOptions = {
  // One job fetched and processed at a time per queue.
  // Increase teamSize for high-throughput queues on a paid tier.
  teamSize:        1,
  teamConcurrency: 1,

  // How often pg-boss polls for new jobs (seconds).
  // 5s is a good balance between latency and DB load on the free tier.
  newJobCheckIntervalSeconds: env.JOB_POLL_INTERVAL_SECONDS,
};

/**
 * Initialises pg-boss and registers all job handlers.
 *
 * pg-boss stores its state in the `pgboss` schema inside your Postgres database.
 * On first boot it runs automatic DDL migrations to create the schema and tables.
 * The DATABASE_URL user must have CREATE SCHEMA privileges for this to succeed.
 *
 * Returns the running PgBoss instance so the caller can call boss.stop() on
 * graceful shutdown.
 */
export async function startWorker(): Promise<PgBoss> {
  // pg-boss creates its own internal connection pool. We must pass the same
  // Session Pooler URL (port 6543) that the API uses — Render's free tier
  // cannot reach Supabase's Direct Connection (port 5432, IPv6 only).
  //
  // pg-boss uses LISTEN/NOTIFY for real-time job pickup. This requires a
  // session-persistent connection, which the Session Pooler (port 6543)
  // provides. The Transaction Pooler (port 5432 via pooler) would break
  // LISTEN/NOTIFY and cause pg-boss to fall back to polling only.
  // Use individual params when available so the password is never URL-encoded.
  const dbConfig = env.DB_HOST
    ? { host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME }
    : { connectionString: env.DATABASE_URL };

  const boss = new PgBoss({
    ...dbConfig,
    max: 3,
    ssl: { rejectUnauthorized: false },

    // Keep completed jobs for 7 days (useful for debugging).
    deleteAfterDays: 7,
    // Keep permanently failed jobs for 30 days — pg-boss v9 uses *Seconds.
    archiveFailedAfterSeconds: 30 * 24 * 3600,
  });

  // ── Lifecycle hooks ─────────────────────────────────────────────────────────
  boss.on('error', (err: Error) => {
    console.error('[pg-boss] Unhandled error:', err.message);
  });

  // Logs queue state counts every monitorStateIntervalMinutes (default: 1 min).
  boss.on('monitor-states', (states: PgBoss.MonitorStates) => {
    const interesting = Object.entries(states.all)
      .filter(([, count]) => (count as number) > 0)
      .map(([state, count]) => `${state}=${count}`)
      .join(' ');
    if (interesting) {
      console.info(`[pg-boss] queue states: ${interesting}`);
    }
  });

  // ── Start pg-boss (runs schema migrations on first boot) ───────────────────
  await boss.start();
  console.info('[worker] pg-boss started — connected to database');

  // ── Register typed job handlers ─────────────────────────────────────────────
  for (const handler of handlers) {
    await boss.work(
      handler.jobName,
      WORK_OPTIONS,
      handler.handle,
    );
    console.info(`[worker] ✓ subscribed to queue: ${handler.jobName}`);
  }

  // ── Dead-Letter Queue handler ────────────────────────────────────────────────
  // Catches jobs that have exceeded their retry limit.
  // Never re-throws so that DLQ jobs are always marked as completed.
  await boss.work<{ [key: string]: unknown }>(
    dlqJobName,
    { ...WORK_OPTIONS, newJobCheckIntervalSeconds: 30 },
    (job) => dlqHandle(job as unknown as PgBoss.Job<import('./types/jobs').DlqJobPayload>),
  );
  console.info(`[worker] ✓ subscribed to DLQ: ${dlqJobName}`);

  const queueCount = handlers.length + 1; // +1 for DLQ
  console.info(`[worker] Listening on ${queueCount} queues. Ready for jobs.`);

  return boss;
}
