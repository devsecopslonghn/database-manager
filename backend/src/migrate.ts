import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for migrations');

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const migrationDir = process.env.MIGRATION_DIR ?? join(process.cwd(), 'migrations');

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schemaops_schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const files = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(join(migrationDir, file), 'utf8');
    const checksum = createHash('sha256').update(sql, 'utf8').digest('hex');
    const existing = await pool.query('SELECT checksum FROM schemaops_schema_migrations WHERE version = $1', [file]);
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`Migration checksum mismatch: ${file}`);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schemaops_schema_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
