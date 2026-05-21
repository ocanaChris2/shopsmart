import { Pool } from 'pg';
import { env } from './env';

// Session Pooler — aws-1-us-east-1.pooler.supabase.com:5432 (IPv4, Supavisor).
// See api/src/config/db.ts for the full connection strategy explanation.
export const pool = new Pool({
  connectionString:        env.DATABASE_URL,
  max:                     env.DB_POOL_MAX,
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis:       30_000,
  ssl:                     { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('[worker-db-pool] Unexpected pool error:', err.message);
});
