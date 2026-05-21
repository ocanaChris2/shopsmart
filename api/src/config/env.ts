import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT:     z.coerce.number().int().positive().default(3000),
  HOST:     z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  DATABASE_URL:  z.string().url(),
  DB_POOL_MAX:   z.coerce.number().int().positive().default(5),

  JWT_SECRET:     z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('24h'),

  RATE_LIMIT_MAX:        z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS:  z.coerce.number().int().positive().default(60_000),
  AUTH_RATE_LIMIT_MAX:   z.coerce.number().int().positive().default(10),

  // Cloudflare cache purge (optional — no-ops when absent)
  CF_ZONE_ID:   z.string().optional(),
  CF_API_TOKEN: z.string().optional(),
  API_BASE_URL: z.string().url().optional().default('http://localhost:3000'),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    console.error('❌  Invalid environment variables:\n', result.error.format());
    process.exit(1);
  }
  return result.data;
}

export const env = load();
