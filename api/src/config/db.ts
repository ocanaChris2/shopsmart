import { Pool } from 'pg';
import { env } from './env';

// =============================================================================
//  Supabase Connection Strategy — Session Pooler (Supavisor)
// =============================================================================
//
//  Render free tier → IPv4 only outbound.
//  Supabase provides three connection endpoints:
//
//  1. DIRECT CONNECTION  db.rmzpevlqzyqwfqhlisjj.supabase.co:5432
//     → Resolves to IPv6 only → UNREACHABLE from Render free tier.
//
//  2. SESSION POOLER     aws-1-us-east-1.pooler.supabase.com:5432
//     → Resolves to IPv4 → REACHABLE ✓
//     → Persistent connection per client session.
//     → Supports LISTEN/NOTIFY (required by pg-boss).
//     → Supports SET LOCAL within a transaction (required by RLS).
//     → Username format: postgres.PROJECT_REF (not just postgres).
//
//  3. TRANSACTION POOLER aws-1-us-east-1.pooler.supabase.com:6543
//     → IPv4 ✓ but NO LISTEN/NOTIFY → breaks pg-boss → do NOT use.
//
//  DATABASE_URL must point to the SESSION POOLER (port 5432, pooler host).
//
// =============================================================================

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max:              env.DB_POOL_MAX,

  // Supabase may take up to 30 s to resume a paused free-tier project.
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis:       30_000,

  // Supabase requires SSL; rejectUnauthorized: false accepts their cert.
  ssl: { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('[db-pool] Unexpected pool error:', err.message);
});

export async function checkDbConnectivity(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
