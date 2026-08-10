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

export function checksumSql(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}
