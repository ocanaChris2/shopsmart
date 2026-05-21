import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT:     z.coerce.number().int().positive().default(3000),
  HOST:     z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // ── Database — individual params (preferred, avoids URL-encoding issues) ──
  DB_HOST:     z.string().optional(),
  DB_PORT:     z.coerce.number().int().positive().optional().default(5432),
  DB_USER:     z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_NAME:     z.string().optional().default('postgres'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(5),

  // ── Fallback: full connection URL (used when DB_HOST is not set) ──────────
  DATABASE_URL: z.string().url().optional(),

  JWT_SECRET:     z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('24h'),

  RATE_LIMIT_MAX:        z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS:  z.coerce.number().int().positive().default(60_000),
  AUTH_RATE_LIMIT_MAX:   z.coerce.number().int().positive().default(10),

  // Allowed frontend origin for CORS (e.g. https://app.yourdomain.com)
  CORS_ORIGIN: z.preprocess((v) => v === '' ? undefined : v, z.string().optional()),

  // Cloudflare cache purge (optional)
  CF_ZONE_ID:   z.preprocess((v) => v === '' ? undefined : v, z.string().optional()),
  CF_API_TOKEN: z.preprocess((v) => v === '' ? undefined : v, z.string().optional()),
  API_BASE_URL: z.preprocess((v) => v === '' ? undefined : v, z.string().url().optional()),
}).refine(
  (d) => !!(d.DB_HOST || d.DATABASE_URL),
  { message: 'Either DB_HOST (+ DB_USER, DB_PASSWORD) or DATABASE_URL must be provided' },
);

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
