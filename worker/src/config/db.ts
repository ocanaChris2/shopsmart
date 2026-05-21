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
    return {
      ...base,
      host:     env.DB_HOST,
      port:     env.DB_PORT,
      user:     env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
    };
  }

  return { ...base, connectionString: env.DATABASE_URL };
}

export const pool = new Pool(buildConfig());

pool.on('error', (err) => {
  console.error('[worker-db-pool] Unexpected pool error:', err.message);
});
