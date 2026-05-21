import { FastifyInstance } from 'fastify';
import { pool } from '../config/db';

/**
 * Keep-Alive Health Routes
 *
 * /health/keep-alive  — Executes a real DB query against Supabase via the
 *                        Session Pooler. Serves two purposes:
 *
 *  1. RENDER WARM-UP: Render free-tier Web Services spin down after 15 minutes
 *     of inactivity. An external cron pinging this endpoint keeps the Fastify
 *     process alive.
 *
 *  2. SUPABASE ANTI-PAUSE: Supabase free-tier databases pause after 7 days of
 *     no queries. The SELECT 1 here counts as a query and resets the pause
 *     timer. Combined with a cron every 5 days, the DB never pauses.
 *
 * Cron setup (cron-job.org — free):
 *   URL:       https://api.yourdomain.com/health/keep-alive
 *   Schedule:  Every 10 minutes  (keeps Render warm)
 *   Separate:  Every 5 days      (keeps Supabase un-paused)
 *
 * This route is intentionally PUBLIC (no JWT) so the cron can call it without
 * credentials. It exposes no sensitive data — only latency and db status.
 */
export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/keep-alive',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status:    { type: 'string' },
              db:        { type: 'string' },
              latencyMs: { type: 'number' },
              ts:        { type: 'string' },
            },
          },
          503: {
            type: 'object',
            properties: {
              status:  { type: 'string' },
              db:      { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      const client = await pool.connect().catch(() => null);

      if (!client) {
        return reply.status(503).send({
          status:  'error',
          db:      'unavailable',
          message: 'Could not acquire a database connection from the pool',
        });
      }

      try {
        const start = Date.now();

        // The SELECT 1 is intentionally trivial — its only job is to:
        //   a) prove the Supabase connection is alive, and
        //   b) reset Supabase's 7-day inactivity pause timer.
        await client.query('SELECT 1 AS alive');

        return reply.status(200).send({
          status:    'ok',
          db:        'connected',
          latencyMs: Date.now() - start,
          ts:        new Date().toISOString(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown DB error';

        fastify.log.error({ err }, '[keep-alive] DB query failed');

        return reply.status(503).send({
          status:  'error',
          db:      'query-failed',
          message,
        });
      } finally {
        client.release();
      }
    },
  );
}
