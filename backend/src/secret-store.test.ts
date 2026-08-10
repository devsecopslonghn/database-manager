import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import type { Pool } from 'pg';
import { DatabaseSecretStore } from './secret-store.js';

test('database secret store encrypts payloads and never returns plaintext metadata', async () => {
  process.env.SCHEMAOPS_MASTER_KEY = randomBytes(32).toString('base64');
  const rows = new Map<string, Record<string, unknown>>();
  const pool = { query: async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith('INSERT INTO schemaops.secret_records')) {
      const row = { tenantId: values[0], secretRef: values[1], kind: values[2], ciphertext: values[3], nonce: values[4], authTag: values[5], description: values[6], version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: values[7], updatedBy: values[7] };
      rows.set(String(values[1]), row); return { rows: [row], rowCount: 1 };
    }
    if (sql.startsWith('SELECT secret_type')) { const row = rows.get(String(values[0])); return { rows: row ? [{ kind: row.kind, ciphertext: row.ciphertext, nonce: row.nonce, authTag: row.authTag }] : [], rowCount: row ? 1 : 0 }; }
    if (sql.startsWith('SELECT tenant_id')) return { rows: [], rowCount: 0 };
    throw new Error(`unexpected query: ${sql}`);
  } } as unknown as Pool;
  const store = new DatabaseSecretStore(pool);
  await store.writeManaged('git-readonly', 'GIT_CREDENTIAL', { username: 'x-access-token', token: 'secret-token' }, 'tester', 'read-only', '00000000-0000-0000-0000-000000000001');
  assert.equal([...rows.values()][0]?.ciphertext && JSON.stringify([...rows.values()][0]).includes('secret-token'), false);
  assert.deepEqual(await store.readGitCredentials('git-readonly'), { username: 'x-access-token', token: 'secret-token' });
  delete process.env.SCHEMAOPS_MASTER_KEY;
});
