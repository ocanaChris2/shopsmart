/**
 * PM2 Ecosystem — ShopSmart ERP
 *
 * Runs the Fastify API and the pg-boss Worker as two separate OS processes
 * inside the single Render free-tier Web Service container (512 MB RAM).
 *
 * Memory budget:
 *   PM2 runtime   ≈  30 MB
 *   API process   ≤ 210 MB   (max_memory_restart: '210M')
 *   Worker process≤ 180 MB   (max_memory_restart: '180M')
 *   OS / headroom ≈  80 MB
 *   ─────────────────────────
 *   Total         ≈ 500 MB   (< 512 MB hard limit)
 *
 * Start command:  npm start  (which runs "pm2-runtime start ecosystem.config.js")
 * pm2-runtime runs in the foreground — required for Docker/container environments.
 */

'use strict';

module.exports = {
  apps: [
    // ── 1. Fastify REST API ─────────────────────────────────────────────────
    {
      name:         'api',
      script:       './api/dist/server.js',
      instances:    1,
      exec_mode:    'fork',

      // Restart if process exceeds 210 MB (protects 512 MB container ceiling).
      max_memory_restart: '210M',

      // Must stay alive for 10 s to count as a successful start.
      min_uptime: '10s',

      // Give up after 10 restarts in a restart window.
      max_restarts: 10,

      // Exponential back-off between restarts (ms): 100, 200, 400, 800 …
      exp_backoff_restart_delay: 100,

      // Stream logs to container stdout/stderr so Render captures them.
      error_file:  '/dev/stderr',
      out_file:    '/dev/stdout',
      merge_logs:  true,
      time:        true,

      // Environment variables are inherited from the Render service env vars.
      // Do NOT put secrets here — they are injected at Render deploy time.
      env: {
        NODE_ENV: 'production',
      },
    },

    // ── 2. pg-boss Background Worker ───────────────────────────────────────
    {
      name:         'worker',
      script:       './worker/dist/server.js',
      instances:    1,
      exec_mode:    'fork',

      // Longer min_uptime: the worker connects to Supabase on start, which
      // may be slow (up to ~30 s) if the DB is paused and resuming.
      max_memory_restart: '180M',
      min_uptime:         '30s',
      max_restarts:       10,
      exp_backoff_restart_delay: 200,

      error_file:  '/dev/stderr',
      out_file:    '/dev/stdout',
      merge_logs:  true,
      time:        true,

      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
