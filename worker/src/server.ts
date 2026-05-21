import 'dotenv/config';         // loads .env if present; no-op otherwise
import { startWorker } from './worker';
import { pool }        from './config/db';

/**
 * Worker entry point.
 *
 * Unlike the REST API (which handles HTTP), this process has no HTTP server.
 * It runs a long-lived pg-boss polling loop and exits only on SIGTERM/SIGINT.
 * Render's Background Worker service type keeps this process running 24/7.
 */
async function main(): Promise<void> {
  console.info('[server] Starting ShopSmart background worker…');

  // Validate database connectivity before entering the polling loop.
  const pingClient = await pool.connect();
  try {
    await pingClient.query('SELECT 1');
    console.info('[server] Database connectivity confirmed');
  } finally {
    pingClient.release();
  }

  const boss = await startWorker();

  // ── Graceful shutdown ────────────────────────────────────────────────────────
  // Render sends SIGTERM before stopping the process.
  // boss.stop({ graceful: true }) waits for in-flight jobs to finish (up to
  // `timeout` ms) before disconnecting — preventing half-written transactions.
  const shutdown = async (signal: string): Promise<void> => {
    console.info(`\n[server] Received ${signal} — initiating graceful shutdown…`);

    try {
      await boss.stop({ graceful: true, timeout: 30_000 });
      console.info('[server] pg-boss stopped cleanly');
    } catch (err) {
      console.error('[server] pg-boss did not stop cleanly:', err);
    }

    try {
      await pool.end();
      console.info('[server] Database pool drained');
    } catch (err) {
      console.error('[server] Error draining pool:', err);
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => { shutdown('SIGTERM').catch(console.error); });
  process.on('SIGINT',  () => { shutdown('SIGINT').catch(console.error); });

  // Keep the process alive — pg-boss's internal interval handles polling.
  // Without this, the Node.js event loop would drain and the process would exit.
  setInterval(() => {
    // Heartbeat: Render's health checks may ping a process signal to verify
    // liveness. Keeping the loop alive is sufficient.
  }, 60_000).unref(); // .unref() so this interval does not prevent shutdown
}

main().catch((err: unknown) => {
  console.error('[server] Fatal startup error:', err);
  process.exit(1);
});
