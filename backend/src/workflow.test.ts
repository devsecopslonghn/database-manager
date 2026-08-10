import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app.js';
import { checksumSql } from './domain.js';
import { executeOperation } from './operation-runner.js';
import { MemoryStore } from './store.js';

test('inventory, plan approval and execution remain auditable and fail closed without target secret', async () => {
  const store = new MemoryStore(); const app = await buildApp(store);
  const project = await store.createProject({ tenantId: randomUUID(), name: 'game-a', databaseEngine: 'postgresql', repositoryUrl: 'https://example.com/game-a.git', defaultRef: 'master', migrationPath: 'migrations' });
  const environment = await store.createEnvironment({ projectId: project.id, name: 'uat' });
  const target = await store.createTarget({ projectId: project.id, environmentId: environment.id, name: 'uat', gitRef: 'master', databaseName: 'game', schemaName: 'public', secretRef: 'schemaops/game-a/uat' });
  await store.upsertBackupPlan({ targetId: target.id, scriptRef: 'demo-backup.sh', requiredBeforeExecute: false, retentionDays: 1 });
  await store.recordConnectionTest(target.id, { status: 'HEALTHY', durationMs: 1, testedAt: new Date().toISOString() });
  await store.createSnapshot({ projectId: project.id, gitRef: 'master', commitSha: 'abc123', sourceFingerprint: 'fingerprint', status: 'SUCCEEDED', createdBy: 'admin', files: [{ path: 'migrations/V1__init.sql', kind: 'VERSIONED', version: '1', description: 'init', checksum: checksumSql('select 1'), sqlPayload: 'select 1' }] });
  const inventory = await store.listInventory(target.id); assert.equal(inventory[0]?.status, 'PENDING');
  const planResponse = await app.inject({ method: 'POST', url: `/api/v1/targets/${target.id}/plans`, payload: {} }); assert.equal(planResponse.statusCode, 201); const plan = planResponse.json() as { id: string; status: string }; assert.equal(plan.status, 'APPROVAL_REQUIRED');
  const approval = await app.inject({ method: 'POST', url: `/api/v1/plans/${plan.id}/approval`, payload: { decision: 'APPROVED' } }); assert.equal(approval.statusCode, 200);
  const queued = await app.inject({ method: 'POST', url: `/api/v1/plans/${plan.id}/execute`, payload: {} }); assert.equal(queued.statusCode, 202); const operationId = (queued.json() as { operationId: string }).operationId;
  await executeOperation(store, operationId, { resolve: async () => undefined });
  const operation = (await store.listOperations()).find((item) => item.id === operationId); assert.equal(operation?.status, 'FAILED'); assert.equal(operation?.errorMessage, 'TARGET_CONNECTION_NOT_AVAILABLE');
  assert.equal((await store.listAuditEvents()).some((event) => event.action === 'migration_operation.failed'), true);
  await app.close();
});
