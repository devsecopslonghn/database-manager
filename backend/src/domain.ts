import { createHash } from 'node:crypto';

export const databaseEngines = ['postgresql', 'mysql', 'oracle', 'sqlserver'] as const;
export type DatabaseEngine = (typeof databaseEngines)[number];

export type Project = {
  id: string;
  tenantId: string;
  name: string;
  databaseEngine: DatabaseEngine;
  repositoryUrl: string;
  defaultRef: string;
  migrationPath: string;
  createdAt: string;
};

export type Environment = {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
};

export type Target = {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  gitRef: string;
  databaseName: string;
  schemaName: string;
  secretRef: string;
  createdAt: string;
};

export type ManualMigration = {
  id: string;
  targetId: string;
  sourceType: 'MANUAL_UI';
  sqlPayload: string;
  checksum: string;
  versionContext?: string;
  executionLabel?: string;
  executionSequence?: number;
  outOfOrder: boolean;
  reason?: string;
  actorId: string;
  status: 'DRAFT' | 'PLANNED' | 'APPROVED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
};

export type MigrationKind = 'VERSIONED' | 'REPEATABLE' | 'UNDO';
export type MigrationSourceType = 'GIT' | 'MANUAL_UI' | 'NATIVE_IMPORT';

export type MigrationFile = {
  id: string;
  snapshotId: string;
  path: string;
  kind: MigrationKind;
  version?: string;
  description: string;
  checksum: string;
  sqlPayload: string;
  createdAt: string;
};

export type SourceSnapshot = {
  id: string;
  projectId: string;
  gitRef: string;
  commitSha: string;
  sourceFingerprint: string;
  status: 'SYNCING' | 'SUCCEEDED' | 'FAILED';
  errorMessage?: string;
  createdBy: string;
  createdAt: string;
};

export type LedgerEntry = {
  id: string;
  targetId: string;
  sourceType: MigrationSourceType;
  migrationFileId?: string;
  path: string;
  kind: MigrationKind | 'MANUAL';
  version?: string;
  description: string;
  checksum: string;
  state: 'APPLIED' | 'ROLLED_BACK' | 'FAILED';
  outOfOrder: boolean;
  executionSequence: number;
  operationId?: string;
  actorId: string;
  durationMs?: number;
  errorMessage?: string;
  appliedAt: string;
};

export type InventoryItem = {
  migrationFileId?: string;
  path: string;
  kind: MigrationKind;
  version?: string;
  description: string;
  checksum: string;
  status: 'APPLIED' | 'PENDING' | 'REPEATABLE' | 'CHANGED' | 'ROLLED_BACK' | 'FAILED';
  appliedAt?: string;
  executionSequence?: number;
  outOfOrder?: boolean;
  sourceSnapshotId?: string;
};

export type MigrationPlanItem = {
  id: string;
  planId: string;
  sourceType: 'GIT' | 'MANUAL_UI';
  migrationFileId?: string;
  path: string;
  kind: string;
  version?: string;
  checksum: string;
  executionSequence: number;
  outOfOrder: boolean;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
};

export type MigrationPlan = {
  id: string;
  targetId: string;
  snapshotId?: string;
  fromVersion?: string;
  toVersion?: string;
  status: 'DRAFT' | 'PREFLIGHT_PASSED' | 'APPROVAL_REQUIRED' | 'APPROVED' | 'REJECTED' | 'EXECUTING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  fingerprint: string;
  autoApprove: boolean;
  createdBy: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
  items: MigrationPlanItem[];
};

export type Operation = {
  id: string;
  targetId: string;
  planId?: string;
  type: 'SYNC' | 'PREFLIGHT' | 'EXECUTE' | 'UNDO' | 'RESTORE' | 'BACKUP';
  status: 'QUEUED' | 'RUNNING' | 'PAUSED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  actorId: string;
  correlationId: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
};

export type BackupPlan = { id: string; targetId: string; scriptRef: string; requiredBeforeExecute: boolean; retentionDays: number; createdAt: string };
export type BackupArtifact = { id: string; targetId: string; operationId?: string; scopeFromVersion?: string; scopeToVersion?: string; artifactRef?: string; checksum?: string; status: 'REQUESTED' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED'; createdAt: string; expiresAt?: string };
export type NativeHistoryImport = { id: string; targetId: string; engine: DatabaseEngine; tableName: string; installedRank?: number; version?: string; description?: string; checksum?: string; success: boolean; installedAt?: string; importedAt: string; evidence: Record<string, unknown> };

export type ExecutionLog = {
  operationId: string;
  operationItemId?: string;
  sequence: number;
  stream: 'stdout' | 'stderr' | 'system';
  message: string;
  redacted: boolean;
  createdAt: string;
};

export type AuditEvent = {
  id: string;
  tenantId?: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type Permission = 'target:view' | 'target:sync' | 'migration:plan' | 'migration:execute' | 'migration:rollback' | 'access:admin';

export const rolePermissions: Record<'TENANT_ADMIN' | 'OPERATOR' | 'VIEWER', Permission[]> = {
  TENANT_ADMIN: ['target:view', 'target:sync', 'migration:plan', 'migration:execute', 'migration:rollback', 'access:admin'],
  OPERATOR: ['target:view', 'target:sync', 'migration:plan', 'migration:execute', 'migration:rollback'],
  VIEWER: ['target:view'],
};

export type Actor = {
  id: string;
  roles: string[];
  tenantIds?: string[];
};

export function checksumSql(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export function fingerprint(values: string[]): string {
  return createHash('sha256').update(values.join('\n'), 'utf8').digest('hex');
}
