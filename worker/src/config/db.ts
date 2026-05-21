import { Pool } from 'pg';
import { env } from './env';

// Must use Supabase Session Pooler (port 6543) — same IPv4 constraint as the
// API. The worker also relies on pg-boss, which requires LISTEN/NOTIFY; only
// session-mode pooling supports this. See api/src/config/db.ts for full notes.
export const pool = new Pool({
  connectionString:        env.DATABASE_URL,  // Session Pooler URL (port 6543)
  max:                     env.DB_POOL_MAX,   // ≤ 3 for worker; leaves room for API
  connectionTimeoutMillis: 15_000,            // allow for DB un-pause delay
  idleTimeoutMillis:       30_000,
  ssl:                     { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('[worker-db-pool] Unexpected pool error:', err.message);
});
