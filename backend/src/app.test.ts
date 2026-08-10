import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildApp } from './app.js';
import { MemoryStore } from './store.js';

test('health and readiness endpoints are available without a target database', async () => {
  const app = await buildApp(new MemoryStore());
  const health = await app.inject({ method: 'GET', url: '/health' });
  const ready = await app.inject({ method: 'GET', url: '/ready' });
  assert.equal(health.statusCode, 200);
  assert.equal(ready.statusCode, 200);
  await app.close();
});

test('tenant onboarding creates and lists a tenant', async () => {
  const store = new MemoryStore();
  const app = await buildApp(store);
  const created = await app.inject({ method: 'POST', url: '/api/v1/tenants', payload: { name: 'Demo Tenant', slug: 'demo-tenant' } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().slug, 'demo-tenant');
  const listed = await app.inject({ method: 'GET', url: '/api/v1/tenants' });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().items.length, 1);
  await app.close();
});

test('manual migration stores source metadata and checksum without exposing SQL', async () => {
  const store = new MemoryStore();
  const app = await buildApp(store);
  const target = await store.createTarget({
    projectId: randomUUID(),
    environmentId: randomUUID(),
    name: 'dev',
    gitRef: 'master',
    databaseName: 'game',
    schemaName: 'public',
    secretRef: 'schemaops/dev-db',
  });
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/targets/${target.id}/manual-migrations`,
    headers: { 'x-actor-id': 'tester' },
    payload: {
      sqlPayload: 'CREATE TABLE sample (id integer);',
      versionContext: 'V7',
      outOfOrder: true,
      executionSequence: 2,
      reason: 'repair missing object',
    },
  });
  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.sourceType, 'MANUAL_UI');
  assert.equal(body.outOfOrder, true);
  assert.equal(body.executionSequence, 2);
  assert.equal('sqlPayload' in body, false);
  assert.equal(store.manualMigrations[0]?.actorId, 'tester');
  assert.match(store.manualMigrations[0]?.checksum ?? '', /^[a-f0-9]{64}$/);
  assert.equal(store.auditEvents[0]?.action, 'manual_migration.created');
  assert.equal(store.auditEvents[0]?.metadata.outOfOrder, true);
  await app.close();
});

test('invalid manual migration payload is rejected', async () => {
  const store = new MemoryStore();
  const app = await buildApp(store);
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/targets/${randomUUID()}/manual-migrations`,
    payload: { sqlPayload: '' },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(store.manualMigrations.length, 0);
  await app.close();
});

test('manual migration can enter the same plan and approval flow without a Git snapshot', async () => {
  const store = new MemoryStore();
  const app = await buildApp(store);
  const target = await store.createTarget({ projectId: randomUUID(), environmentId: randomUUID(), name: 'uat', gitRef: 'master', databaseName: 'game', schemaName: 'public', secretRef: 'schemaops/uat-db' });
  const created = await app.inject({ method: 'POST', url: `/api/v1/targets/${target.id}/manual-migrations`, payload: { sqlPayload: 'CREATE INDEX sample_idx ON sample(id);', executionLabel: 'repair-index', reason: 'repair drift' } });
  const draft = created.json() as { id: string };
  const planned = await app.inject({ method: 'POST', url: `/api/v1/manual-migrations/${draft.id}/plan`, payload: {} });
  assert.equal(planned.statusCode, 201);
  assert.equal(planned.json().items[0].sourceType, 'MANUAL_UI');
  const preflight = await app.inject({ method: 'POST', url: `/api/v1/plans/${planned.json().id}/preflight`, payload: {} });
  assert.equal(preflight.statusCode, 200);
  assert.equal(preflight.json().checks.find((check: { name: string }) => check.name === 'source_snapshot').status, 'PASSED');
  await app.close();
});

test('OIDC mode rejects mutation requests without a bearer token', async () => {
  const previousMode = process.env.AUTH_MODE;
  const previousJwks = process.env.OIDC_JWKS_URL;
  process.env.AUTH_MODE = 'oidc';
  process.env.OIDC_JWKS_URL = 'https://issuer.example/.well-known/jwks.json';
  const app = await buildApp(new MemoryStore());
  const response = await app.inject({ method: 'POST', url: '/api/v1/projects', payload: {} });
  assert.equal(response.statusCode, 401);
  await app.close();
  if (previousMode === undefined) delete process.env.AUTH_MODE; else process.env.AUTH_MODE = previousMode;
  if (previousJwks === undefined) delete process.env.OIDC_JWKS_URL; else process.env.OIDC_JWKS_URL = previousJwks;
});
