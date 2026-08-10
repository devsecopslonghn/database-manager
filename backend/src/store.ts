import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { ManualMigration, Project, Target } from './domain.js';

export type CreateProjectInput = Omit<Project, 'id' | 'createdAt'>;
export type CreateTargetInput = Omit<Target, 'id' | 'createdAt'>;
export type CreateManualMigrationInput = Omit<ManualMigration, 'id' | 'createdAt' | 'updatedAt'>;
export type AuditEventInput = {
  targetId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
};

export interface Store {
  ready(): Promise<void>;
  createProject(input: CreateProjectInput): Promise<Project>;
  createTarget(input: CreateTargetInput): Promise<Target>;
  getTarget(id: string): Promise<Target | undefined>;
  createManualMigration(input: CreateManualMigrationInput): Promise<ManualMigration>;
  listManualMigrations(targetId: string): Promise<ManualMigration[]>;
  recordTargetAudit(input: AuditEventInput): Promise<void>;
}

export class MemoryStore implements Store {
  readonly projects: Project[] = [];
  readonly targets: Target[] = [];
  readonly manualMigrations: ManualMigration[] = [];
  readonly auditEvents: AuditEventInput[] = [];

  async ready(): Promise<void> {}

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project: Project = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.projects.push(project);
    return project;
  }

  async createTarget(input: CreateTargetInput): Promise<Target> {
    const target: Target = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.targets.push(target);
    return target;
  }

  async getTarget(id: string): Promise<Target | undefined> {
    return this.targets.find((target) => target.id === id);
  }

  async createManualMigration(input: CreateManualMigrationInput): Promise<ManualMigration> {
    const now = new Date().toISOString();
    const migration: ManualMigration = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    this.manualMigrations.push(migration);
    return migration;
  }

  async listManualMigrations(targetId: string): Promise<ManualMigration[]> {
    return this.manualMigrations.filter((migration) => migration.targetId === targetId);
  }

  async recordTargetAudit(input: AuditEventInput): Promise<void> {
    this.auditEvents.push(input);
  }
}

export class PostgresStore implements Store {
  constructor(private readonly pool: Pool) {}

  async ready(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const result = await this.pool.query(
      `INSERT INTO schemaops.projects (tenant_id, name, database_engine, repository_url, default_ref, migration_path)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, tenant_id AS "tenantId", name, database_engine AS "databaseEngine",
                 repository_url AS "repositoryUrl", default_ref AS "defaultRef",
                 migration_path AS "migrationPath", created_at AS "createdAt"`,
      [input.tenantId, input.name, input.databaseEngine, input.repositoryUrl, input.defaultRef, input.migrationPath],
    );
    return result.rows[0] as Project;
  }

  async createTarget(input: CreateTargetInput): Promise<Target> {
    const result = await this.pool.query(
      `INSERT INTO schemaops.targets (project_id, environment_id, name, git_ref, database_name, schema_name, secret_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, project_id AS "projectId", environment_id AS "environmentId", name,
                 git_ref AS "gitRef", database_name AS "databaseName", schema_name AS "schemaName",
                 secret_ref AS "secretRef", created_at AS "createdAt"`,
      [input.projectId, input.environmentId, input.name, input.gitRef, input.databaseName, input.schemaName, input.secretRef],
    );
    return result.rows[0] as Target;
  }

  async getTarget(id: string): Promise<Target | undefined> {
    const result = await this.pool.query(
      `SELECT id, project_id AS "projectId", environment_id AS "environmentId", name,
              git_ref AS "gitRef", database_name AS "databaseName", schema_name AS "schemaName",
              secret_ref AS "secretRef", created_at AS "createdAt"
       FROM schemaops.targets WHERE id = $1`,
      [id],
    );
    return result.rows[0] as Target | undefined;
  }

  async createManualMigration(input: CreateManualMigrationInput): Promise<ManualMigration> {
    const result = await this.pool.query(
      `INSERT INTO schemaops.manual_migrations
       (target_id, sql_payload, checksum, version_context, execution_label,
        execution_sequence, out_of_order, reason, actor_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, target_id AS "targetId", source_type AS "sourceType", sql_payload AS "sqlPayload",
                 checksum, version_context AS "versionContext", execution_label AS "executionLabel",
                 execution_sequence AS "executionSequence", out_of_order AS "outOfOrder", reason,
                 actor_id AS "actorId", status, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [input.targetId, input.sqlPayload, input.checksum, input.versionContext ?? null,
        input.executionLabel ?? null, input.executionSequence ?? null, input.outOfOrder,
        input.reason ?? null, input.actorId, input.status],
    );
    return result.rows[0] as ManualMigration;
  }

  async listManualMigrations(targetId: string): Promise<ManualMigration[]> {
    const result = await this.pool.query(
      `SELECT id, target_id AS "targetId", source_type AS "sourceType", sql_payload AS "sqlPayload",
              checksum, version_context AS "versionContext", execution_label AS "executionLabel",
              execution_sequence AS "executionSequence", out_of_order AS "outOfOrder", reason,
              actor_id AS "actorId", status, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM schemaops.manual_migrations WHERE target_id = $1 ORDER BY created_at DESC`,
      [targetId],
    );
    return result.rows as ManualMigration[];
  }

  async recordTargetAudit(input: AuditEventInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO schemaops.audit_events (tenant_id, actor_id, action, resource_type, resource_id, metadata)
       SELECT p.tenant_id, $2, $3, $4, $5, $6::jsonb
       FROM schemaops.targets t JOIN schemaops.projects p ON p.id = t.project_id
       WHERE t.id = $1`,
      [input.targetId, input.actorId, input.action, input.resourceType, input.resourceId, JSON.stringify(input.metadata)],
    );
  }
}
