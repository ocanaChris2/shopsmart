import { z } from 'zod';

const schema = z.object({
  NODE_ENV:  z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),
  DB_POOL_MAX:  z.coerce.number().int().positive().default(5),

  JOB_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(5),

  STORAGE_BASE_URL: z.string().url().default('https://storage.example.com/exports'),
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
