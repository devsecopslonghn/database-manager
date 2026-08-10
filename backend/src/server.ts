import { Pool } from 'pg';
import { buildApp } from './app.js';
import { PostgresStore } from './store.js';
import { DatabaseSecretStore } from './secret-store.js';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error('DATABASE_URL is required for the backend server');

const pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.DB_POOL_MAX ?? 10) });
const app = await buildApp(new PostgresStore(pool), { secretManager: new DatabaseSecretStore(pool) });

const close = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
  process.exit(0);
};

process.once('SIGTERM', () => void close('SIGTERM'));
process.once('SIGINT', () => void close('SIGINT'));

await app.listen({ port, host });
