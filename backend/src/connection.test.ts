import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildApp } from './app.js';
import type { ConnectionSecret, ConnectionSecretStore } from './secret-store.js';
import { MemoryStore } from './store.js';

class FakeSecretStore implements ConnectionSecretStore {
  readonly values = new Map<string, ConnectionSecret>();
  async write(ref: string, value: ConnectionSecret) { this.values.set(ref, value); return { version: `v-${this.values.size}` }; }
  async read(ref: string) { return this.values.get(ref); }
}

test('admin connection UI API writes credentials to secret manager, never response or control-plane metadata', async () => {
  const store = new MemoryStore(); const secrets = new FakeSecretStore();
  const project = await store.createProject({ tenantId: randomUUID(), name: 'connection-test', databaseEngine: 'postgresql', repositoryUrl: 'https://example.com/repo.git', defaultRef: 'master', migrationPath: 'migrations' });
  const environment = await store.createEnvironment({ projectId: project.id, name: 'dev' });
  const target = await store.createTarget({ projectId: project.id, environmentId: environment.id, name: 'dev', gitRef: 'master', databaseName: 'old', schemaName: 'public', secretRef: 'old-secret' });
  const app = await buildApp(store, { secretManager: secrets, connectionTester: async () => ({ durationMs: 12 }) });
  const save = await app.inject({ method: 'PUT', url: `/api/v1/targets/${target.id}/connection`, payload: { host: 'db.internal', port: 5432, databaseName: 'game', schemaName: 'public', username: 'schemaops', password: 'do-not-return', secretBackend: 'kubernetes', secretRef: 'game-dev-credentials', sslMode: 'require', timeoutSeconds: 30 } });
  assert.equal(save.statusCode, 200); const body = save.json() as Record<string, unknown>; assert.equal('password' in body, false); assert.equal(secrets.values.get('game-dev-credentials')?.password, 'do-not-return');
  const stored = await store.getTargetConnection(target.id); assert.equal(JSON.stringify(stored).includes('do-not-return'), false); assert.equal(stored?.credentialVersion, 'v-1');
  const tested = await app.inject({ method: 'POST', url: `/api/v1/targets/${target.id}/connection/test`, payload: {} }); assert.equal(tested.statusCode, 200); assert.equal(tested.json().status, 'HEALTHY');
  const rotated = await app.inject({ method: 'POST', url: `/api/v1/targets/${target.id}/connection/rotate`, payload: { password: 'new-secret', reason: 'scheduled rotation', confirm: true } }); assert.equal(rotated.statusCode, 200); assert.equal(rotated.json().password, undefined); assert.equal(secrets.values.get('game-dev-credentials')?.password, 'new-secret');
  const audits = await store.listAuditEvents(); assert.equal(audits.filter((event) => event.resourceType === 'target_connection').length, 3);
  await app.close();
});
