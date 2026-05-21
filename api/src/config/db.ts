import { Pool } from 'pg';
import { env } from './env';

// =============================================================================
//  Supabase Session Pooler — Connection Strategy
// =============================================================================
//
//  WHY Session Pooler (port 6543) and NOT the Direct Connection (port 5432):
//
//  1. IPv4 CONSTRAINT: Render's free tier provides IPv4-only outbound networking.
//     The Supabase Direct Connection host (db.xxxx.supabase.co) resolves to an
//     IPv6 address, making it unreachable from Render's free tier.
//
//  2. Session Pooler (port 6543) resolves to IPv4-compatible addresses on the
//     Supabase-managed PgBouncer fleet:
//       aws-0-[region].pooler.supabase.com:6543
//
//  3. WHY Session Mode and NOT Transaction Mode:
//     - Transaction Mode (port 5432 via pooler): connections are returned to
//       the pool after each transaction. pg-boss requires LISTEN/NOTIFY, which
//       is only supported in session-persistent connections.
//     - Session Mode (port 6543): each client connection maps to one server
//       connection for its lifetime. LISTEN/NOTIFY works, and SET LOCAL within
//       a transaction is correctly cleared when the transaction ends.
//
//  DATABASE_URL format for Session Pooler:
//    postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
//
//  The DIRECT_URL (port 5432) is used ONLY for schema migrations, run from a
//  local machine or GitHub Actions (which can reach Supabase's IPv6 endpoint).
//  It is never set in Render environment variables.
//
// =============================================================================

export const pool = new Pool({
  connectionString: env.DATABASE_URL,   // must point to Session Pooler (port 6543)
  max:              env.DB_POOL_MAX,    // keep ≤ 5; Supabase free tier = 60 total conns

  // Supabase free tier pauses the database after 7 days of inactivity and takes
  // up to 30 seconds to resume. A longer connection timeout prevents false-positive
  // "DB unavailable" errors on the first request after a long idle period.
  connectionTimeoutMillis: 15_000,

  // Release idle connections after 30 s so we don't hold precious pooler slots.
  idleTimeoutMillis: 30_000,

  // Supabase requires SSL. The Supabase CA is self-signed from the client's
  // perspective when connecting via the pooler; rejectUnauthorized: false
  // disables cert chain validation (still encrypted, just not chain-verified).
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
