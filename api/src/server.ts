import { buildApp }            from './app';
import { env }                 from './config/env';
import { checkDbConnectivity } from './config/db';
import { pool }                from './config/db';
import { stopQueue }           from './services/queue';

async function start(): Promise<void> {
  const app = await buildApp();

  // Verify the DB is reachable before accepting traffic.
  await checkDbConnectivity();
  app.log.info('PostgreSQL connection pool is healthy');

  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`Server listening on ${env.HOST}:${env.PORT} [${env.NODE_ENV}]`);
}

// Graceful shutdown: drain pg-boss producer and connection pool.
async function shutdown(signal: string): Promise<void> {
  console.log(`\nReceived ${signal}. Shutting down gracefully…`);
  await stopQueue();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => { shutdown('SIGTERM').catch(console.error); });
process.on('SIGINT',  () => { shutdown('SIGINT').catch(console.error); });

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
