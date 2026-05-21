import { FastifyInstance } from 'fastify';
import { authRoutes }   from './auth.routes';
import { dataRoutes }   from './data.routes';
import { healthRoutes } from './health.routes';
import { authenticate } from '../middleware/authenticate';
import {
  rlsPreHandler,
  rlsOnSend,
  rlsOnResponse,
  rlsOnRequestAbort,
} from '../middleware/rlsTransaction';

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  // ── Shallow health check (public, no DB query) ────────────────────────────
  // Used by Render's health-check probe to determine service readiness.
  fastify.get('/health', async (_req, reply) => {
    reply.status(200).send({ status: 'ok', ts: new Date().toISOString() });
  });

  // ── DB keep-alive health check (public, hits Supabase) ───────────────────
  // Pinged by cron-job.org every 10 min to keep both Render and Supabase awake.
  // Registered under /health/* to keep it separate from the protected /api/v1/ scope.
  fastify.register(healthRoutes, { prefix: '/health' });

  // ── Auth (public) ─────────────────────────────────────────────────────────
  fastify.register(authRoutes, { prefix: '/auth' });

  // ── Protected scope ───────────────────────────────────────────────────────
  // All hooks registered here are scoped: they apply ONLY to routes registered
  // within this async function, not to /health or /auth.
  fastify.register(async function protectedScope(api) {
    // 1. Verify JWT — populates request.user
    api.addHook('onRequest', authenticate);

    // 2. Open a pg transaction and SET LOCAL app.current_tenant_id
    api.addHook('preHandler', rlsPreHandler);

    // 3. COMMIT on success, ROLLBACK on error — fires before response bytes flush
    api.addHook('onSend', rlsOnSend);

    // 4. Release the pg client back to the pool
    api.addHook('onResponse', rlsOnResponse);

    // 5. Clean up if the HTTP client disconnects mid-flight
    api.addHook('onRequestAbort', rlsOnRequestAbort);

    // Register protected resource routes
    api.register(dataRoutes, { prefix: '/data' });
  }, { prefix: '/api/v1' });
}
