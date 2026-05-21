import { z } from 'zod';

const schema = z.object({
  NODE_ENV:  z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Individual params (preferred — no URL-encoding issues with special chars)
  DB_HOST:     z.string().optional(),
  DB_PORT:     z.coerce.number().int().positive().optional().default(5432),
  DB_USER:     z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_NAME:     z.string().optional().default('postgres'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(3),

  // Fallback full URL (used when DB_HOST is not set)
  DATABASE_URL: z.string().url().optional(),

  JOB_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(5),
  STORAGE_BASE_URL: z.string().url().default('https://storage.example.com/exports'),
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
