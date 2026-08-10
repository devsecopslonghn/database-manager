import assert from 'node:assert/strict';
import test from 'node:test';
import { actorFromClaims, can, requirePermission, AuthorizationError } from './rbac.js';

test('maps Keycloak realm and audience roles to permissions', () => {
  const actor = actorFromClaims('alice', { realm_access: { roles: ['database-manager-viewer'] }, resource_access: { 'database-manager-api': { roles: ['viewer'] } } });
  assert.equal(can(actor, 'target:view'), true);
  assert.equal(can(actor, 'migration:execute'), false);
  assert.throws(() => requirePermission(actor, 'migration:execute'), AuthorizationError);
});

test('database manager admin has full control-plane permission', () => {
  const actor = actorFromClaims('admin', { realm_access: { roles: ['database-manager-admin'] } });
  assert.equal(can(actor, 'access:admin'), true);
  assert.equal(can(actor, 'migration:rollback'), true);
});
