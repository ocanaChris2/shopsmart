import { Pool, type PoolConfig } from 'pg';
import { env } from './env';

function buildConfig(): PoolConfig {
  const base: PoolConfig = {
    max:                     env.DB_POOL_MAX,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis:       30_000,
    ssl:                     { rejectUnauthorized: false },
  };

  if (env.DB_HOST) {
    // Individual params — password is a plain string, no URL encoding needed.
    // Use this when the password contains special characters (@, >, <, /, etc.)
    // that would be misinterpreted if embedded in a connection URL.
    return {
      ...base,
      host:     env.DB_HOST,
      port:     env.DB_PORT,
      user:     env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
    };
  }

  // Fallback: full DATABASE_URL (pg decodes URL-encoded chars in the password)
  return { ...base, connectionString: env.DATABASE_URL };
}

export const pool = new Pool(buildConfig());

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
