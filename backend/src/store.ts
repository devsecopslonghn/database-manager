import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  AuditEvent, Environment, ExecutionLog, InventoryItem, LedgerEntry, ManualMigration, MigrationFile,
  MigrationPlan, MigrationPlanItem, Operation, Project, SourceSnapshot, Target,
} from './domain.js';

export type CreateProjectInput = Omit<Project, 'id' | 'createdAt'>;
export type CreateEnvironmentInput = Omit<Environment, 'id' | 'createdAt'>;
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
export type CreateSnapshotInput = Omit<SourceSnapshot, 'id' | 'createdAt'> & { files: Array<Omit<MigrationFile, 'id' | 'snapshotId' | 'createdAt'>> };
export type CreatePlanInput = Omit<MigrationPlan, 'id' | 'createdAt' | 'updatedAt' | 'items'> & { items: Array<Omit<MigrationPlanItem, 'id' | 'planId'>> };

export interface Store {
  ready(): Promise<void>;
  createProject(input: CreateProjectInput): Promise<Project>;
  getProject(id: string): Promise<Project | undefined>;
  listProjects(tenantId?: string): Promise<Project[]>;
  createEnvironment(input: CreateEnvironmentInput): Promise<Environment>;
  listEnvironments(projectId: string): Promise<Environment[]>;
  createTarget(input: CreateTargetInput): Promise<Target>;
  listTargets(projectId?: string): Promise<Target[]>;
  getTarget(id: string): Promise<Target | undefined>;
  createManualMigration(input: CreateManualMigrationInput): Promise<ManualMigration>;
  listManualMigrations(targetId: string): Promise<ManualMigration[]>;
  recordTargetAudit(input: AuditEventInput): Promise<void>;
  listAuditEvents(tenantId?: string, limit?: number): Promise<AuditEvent[]>;
  createSnapshot(input: CreateSnapshotInput): Promise<SourceSnapshot>;
  getLatestSnapshot(projectId: string, gitRef?: string): Promise<SourceSnapshot | undefined>;
  listMigrationFiles(snapshotId: string): Promise<MigrationFile[]>;
  listLedger(targetId: string): Promise<LedgerEntry[]>;
  appendLedger(entry: Omit<LedgerEntry, 'id'>): Promise<LedgerEntry>;
  acquireTargetLock(targetId: string, operationId: string, holderId: string): Promise<boolean>;
  releaseTargetLock(targetId: string, operationId: string): Promise<void>;
  listInventory(targetId: string): Promise<InventoryItem[]>;
  createPlan(input: CreatePlanInput): Promise<MigrationPlan>;
  getPlan(id: string): Promise<MigrationPlan | undefined>;
  listPlans(targetId?: string): Promise<MigrationPlan[]>;
  approvePlan(planId: string, actorId: string, decision: 'APPROVED' | 'REJECTED', reason?: string): Promise<MigrationPlan | undefined>;
  createOperation(input: Omit<Operation, 'id' | 'createdAt'>): Promise<Operation>;
  updateOperation(id: string, patch: Partial<Pick<Operation, 'status' | 'startedAt' | 'finishedAt' | 'errorMessage'>>): Promise<Operation | undefined>;
  listOperations(targetId?: string): Promise<Operation[]>;
  appendExecutionLog(input: ExecutionLog): Promise<void>;
  listExecutionLogs(operationId: string): Promise<ExecutionLog[]>;
}

function now(): string { return new Date().toISOString(); }

export class MemoryStore implements Store {
  readonly projects: Project[] = [];
  readonly environments: Environment[] = [];
  readonly targets: Target[] = [];
  readonly manualMigrations: ManualMigration[] = [];
  readonly auditEvents: AuditEventInput[] = [];
  readonly snapshots: SourceSnapshot[] = [];
  readonly migrationFiles: MigrationFile[] = [];
  readonly ledger: LedgerEntry[] = [];
  readonly plans: MigrationPlan[] = [];
  readonly operations: Operation[] = [];
  readonly executionLogs: ExecutionLog[] = [];

  async ready(): Promise<void> {}

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project: Project = { ...input, id: randomUUID(), createdAt: now() };
    this.projects.push(project);
    return project;
  }

  async listProjects(tenantId?: string): Promise<Project[]> { return this.projects.filter((p) => !tenantId || p.tenantId === tenantId); }
  async getProject(id: string): Promise<Project | undefined> { return this.projects.find((project) => project.id === id); }

  async createEnvironment(input: CreateEnvironmentInput): Promise<Environment> {
    const environment: Environment = { ...input, id: randomUUID(), createdAt: now() };
    this.environments.push(environment);
    return environment;
  }

  async listEnvironments(projectId: string): Promise<Environment[]> { return this.environments.filter((e) => e.projectId === projectId); }

  async createTarget(input: CreateTargetInput): Promise<Target> {
    const target: Target = { ...input, id: randomUUID(), createdAt: now() };
    this.targets.push(target);
    return target;
  }

  async listTargets(projectId?: string): Promise<Target[]> { return this.targets.filter((t) => !projectId || t.projectId === projectId); }
  async getTarget(id: string): Promise<Target | undefined> { return this.targets.find((target) => target.id === id); }

  async createManualMigration(input: CreateManualMigrationInput): Promise<ManualMigration> {
    const timestamp = now();
    const migration: ManualMigration = { ...input, id: randomUUID(), createdAt: timestamp, updatedAt: timestamp };
    this.manualMigrations.push(migration);
    return migration;
  }

  async listManualMigrations(targetId: string): Promise<ManualMigration[]> { return this.manualMigrations.filter((m) => m.targetId === targetId); }
  async recordTargetAudit(input: AuditEventInput): Promise<void> { this.auditEvents.push(input); }
  async listAuditEvents(_tenantId?: string, limit = 100): Promise<AuditEvent[]> {
    return this.auditEvents.slice(-limit).reverse().map((event) => ({ ...event, id: randomUUID(), createdAt: now() }));
  }

  async createSnapshot(input: CreateSnapshotInput): Promise<SourceSnapshot> {
    const snapshot: SourceSnapshot = { ...input, id: randomUUID(), createdAt: now() };
    const { files, ...metadata } = input;
    this.snapshots.push(snapshot);
    for (const file of files) this.migrationFiles.push({ ...file, id: randomUUID(), snapshotId: snapshot.id, createdAt: now() });
    return snapshot;
  }

  async getLatestSnapshot(projectId: string, gitRef?: string): Promise<SourceSnapshot | undefined> {
    return [...this.snapshots].reverse().find((s) => s.projectId === projectId && (!gitRef || s.gitRef === gitRef));
  }
  async listMigrationFiles(snapshotId: string): Promise<MigrationFile[]> { return this.migrationFiles.filter((f) => f.snapshotId === snapshotId); }
  async listLedger(targetId: string): Promise<LedgerEntry[]> { return this.ledger.filter((entry) => entry.targetId === targetId); }
  async appendLedger(entry: Omit<LedgerEntry, 'id'>): Promise<LedgerEntry> { const value={...entry,id:randomUUID()}; this.ledger.push(value); return value; }
  private readonly locks = new Map<string, string>();
  async acquireTargetLock(targetId: string, operationId: string): Promise<boolean> { if (this.locks.has(targetId)) return false; this.locks.set(targetId, operationId); return true; }
  async releaseTargetLock(targetId: string, operationId: string): Promise<void> { if (this.locks.get(targetId) === operationId) this.locks.delete(targetId); }

  async listInventory(targetId: string): Promise<InventoryItem[]> {
    const target = await this.getTarget(targetId);
    if (!target) return [];
    const snapshot = await this.getLatestSnapshot(this.projects.find((p) => p.id === target.projectId)?.id ?? '');
    if (!snapshot) return [];
    const files = await this.listMigrationFiles(snapshot.id);
    const ledger = await this.listLedger(targetId);
    return files.map((file) => {
      const applied = [...ledger].reverse().find((entry) => entry.path === file.path && entry.state === 'APPLIED');
      const previous = [...ledger].reverse().find((entry) => entry.path === file.path);
      const repeatable = file.kind === 'REPEATABLE';
      return { migrationFileId: file.id, path: file.path, kind: file.kind, version: file.version, description: file.description, checksum: file.checksum,
        status: previous?.state === 'FAILED' ? 'FAILED' : applied && applied.checksum === file.checksum ? (repeatable ? 'REPEATABLE' : 'APPLIED') : applied ? 'CHANGED' : 'PENDING',
        appliedAt: applied?.appliedAt, executionSequence: applied?.executionSequence, outOfOrder: applied?.outOfOrder, sourceSnapshotId: snapshot.id };
    });
  }

  async createPlan(input: CreatePlanInput): Promise<MigrationPlan> {
    const timestamp = now();
    const plan: MigrationPlan = { ...input, id: randomUUID(), createdAt: timestamp, updatedAt: timestamp, items: input.items.map((item) => ({ ...item, id: randomUUID(), planId: '' })) };
    plan.items = plan.items.map((item) => ({ ...item, planId: plan.id }));
    this.plans.push(plan);
    return plan;
  }
  async getPlan(id: string): Promise<MigrationPlan | undefined> { return this.plans.find((p) => p.id === id); }
  async listPlans(targetId?: string): Promise<MigrationPlan[]> { return this.plans.filter((p) => !targetId || p.targetId === targetId); }
  async approvePlan(planId: string, actorId: string, decision: 'APPROVED' | 'REJECTED', _reason?: string): Promise<MigrationPlan | undefined> {
    const plan = await this.getPlan(planId);
    if (!plan) return undefined;
    plan.status = decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    plan.approvedBy = actorId;
    plan.updatedAt = now();
    return plan;
  }
  async createOperation(input: Omit<Operation, 'id' | 'createdAt'>): Promise<Operation> {
    const operation: Operation = { ...input, id: randomUUID(), createdAt: now() };
    this.operations.push(operation);
    return operation;
  }
  async updateOperation(id: string, patch: Partial<Pick<Operation, 'status' | 'startedAt' | 'finishedAt' | 'errorMessage'>>): Promise<Operation | undefined> {
    const operation = this.operations.find((item) => item.id === id);
    if (!operation) return undefined;
    Object.assign(operation, patch);
    return operation;
  }
  async listOperations(targetId?: string): Promise<Operation[]> { return this.operations.filter((o) => !targetId || o.targetId === targetId).slice().reverse(); }
  async appendExecutionLog(input: ExecutionLog): Promise<void> { this.executionLogs.push(input); }
  async listExecutionLogs(operationId: string): Promise<ExecutionLog[]> { return this.executionLogs.filter((log) => log.operationId === operationId).sort((a, b) => a.sequence - b.sequence); }
}

export class PostgresStore implements Store {
  constructor(private readonly pool: Pool) {}
  async ready(): Promise<void> { await this.pool.query('SELECT 1'); }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const result = await this.pool.query(`INSERT INTO schemaops.projects (tenant_id, name, database_engine, repository_url, default_ref, migration_path)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,tenant_id AS "tenantId",name,database_engine AS "databaseEngine",repository_url AS "repositoryUrl",default_ref AS "defaultRef",migration_path AS "migrationPath",created_at AS "createdAt"`,
      [input.tenantId, input.name, input.databaseEngine, input.repositoryUrl, input.defaultRef, input.migrationPath]);
    return result.rows[0] as Project;
  }
  async getProject(id: string): Promise<Project | undefined> { const result=await this.pool.query(`SELECT id,tenant_id AS "tenantId",name,database_engine AS "databaseEngine",repository_url AS "repositoryUrl",default_ref AS "defaultRef",migration_path AS "migrationPath",created_at AS "createdAt" FROM schemaops.projects WHERE id=$1`,[id]); return result.rows[0] as Project|undefined; }
  async listProjects(tenantId?: string): Promise<Project[]> {
    const result = await this.pool.query(`SELECT id,tenant_id AS "tenantId",name,database_engine AS "databaseEngine",repository_url AS "repositoryUrl",default_ref AS "defaultRef",migration_path AS "migrationPath",created_at AS "createdAt" FROM schemaops.projects ${tenantId ? 'WHERE tenant_id=$1' : ''} ORDER BY name`, tenantId ? [tenantId] : []);
    return result.rows as Project[];
  }
  async createEnvironment(input: CreateEnvironmentInput): Promise<Environment> {
    const result = await this.pool.query(`INSERT INTO schemaops.environments (project_id,name) VALUES ($1,$2) RETURNING id,project_id AS "projectId",name,created_at AS "createdAt"`, [input.projectId, input.name]);
    return result.rows[0] as Environment;
  }
  async listEnvironments(projectId: string): Promise<Environment[]> {
    const result = await this.pool.query(`SELECT id,project_id AS "projectId",name,created_at AS "createdAt" FROM schemaops.environments WHERE project_id=$1 ORDER BY name`, [projectId]);
    return result.rows as Environment[];
  }
  async createTarget(input: CreateTargetInput): Promise<Target> {
    const result = await this.pool.query(`INSERT INTO schemaops.targets (project_id,environment_id,name,git_ref,database_name,schema_name,secret_ref) VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id,project_id AS "projectId",environment_id AS "environmentId",name,git_ref AS "gitRef",database_name AS "databaseName",schema_name AS "schemaName",secret_ref AS "secretRef",created_at AS "createdAt"`,
      [input.projectId, input.environmentId, input.name, input.gitRef, input.databaseName, input.schemaName, input.secretRef]);
    return result.rows[0] as Target;
  }
  async listTargets(projectId?: string): Promise<Target[]> {
    const result = await this.pool.query(`SELECT id,project_id AS "projectId",environment_id AS "environmentId",name,git_ref AS "gitRef",database_name AS "databaseName",schema_name AS "schemaName",secret_ref AS "secretRef",created_at AS "createdAt" FROM schemaops.targets ${projectId ? 'WHERE project_id=$1' : ''} ORDER BY name`, projectId ? [projectId] : []);
    return result.rows as Target[];
  }
  async getTarget(id: string): Promise<Target | undefined> {
    const result = await this.pool.query(`SELECT id,project_id AS "projectId",environment_id AS "environmentId",name,git_ref AS "gitRef",database_name AS "databaseName",schema_name AS "schemaName",secret_ref AS "secretRef",created_at AS "createdAt" FROM schemaops.targets WHERE id=$1`, [id]);
    return result.rows[0] as Target | undefined;
  }
  async createManualMigration(input: CreateManualMigrationInput): Promise<ManualMigration> {
    const result = await this.pool.query(`INSERT INTO schemaops.manual_migrations (target_id,sql_payload,checksum,version_context,execution_label,execution_sequence,out_of_order,reason,actor_id,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,target_id AS "targetId",source_type AS "sourceType",sql_payload AS "sqlPayload",checksum,version_context AS "versionContext",execution_label AS "executionLabel",execution_sequence AS "executionSequence",out_of_order AS "outOfOrder",reason,actor_id AS "actorId",status,created_at AS "createdAt",updated_at AS "updatedAt"`,
      [input.targetId,input.sqlPayload,input.checksum,input.versionContext ?? null,input.executionLabel ?? null,input.executionSequence ?? null,input.outOfOrder,input.reason ?? null,input.actorId,input.status]);
    return result.rows[0] as ManualMigration;
  }
  async listManualMigrations(targetId: string): Promise<ManualMigration[]> {
    const result = await this.pool.query(`SELECT id,target_id AS "targetId",source_type AS "sourceType",sql_payload AS "sqlPayload",checksum,version_context AS "versionContext",execution_label AS "executionLabel",execution_sequence AS "executionSequence",out_of_order AS "outOfOrder",reason,actor_id AS "actorId",status,created_at AS "createdAt",updated_at AS "updatedAt" FROM schemaops.manual_migrations WHERE target_id=$1 ORDER BY created_at DESC`, [targetId]);
    return result.rows as ManualMigration[];
  }
  async recordTargetAudit(input: AuditEventInput): Promise<void> {
    await this.pool.query(`INSERT INTO schemaops.audit_events (tenant_id,actor_id,action,resource_type,resource_id,metadata) SELECT p.tenant_id,$2,$3,$4,$5,$6::jsonb FROM schemaops.targets t JOIN schemaops.projects p ON p.id=t.project_id WHERE t.id=$1`, [input.targetId,input.actorId,input.action,input.resourceType,input.resourceId,JSON.stringify(input.metadata)]);
  }
  async listAuditEvents(tenantId?: string, limit = 100): Promise<AuditEvent[]> {
    const result = await this.pool.query(`SELECT id,tenant_id AS "tenantId",actor_id AS "actorId",action,resource_type AS "resourceType",resource_id AS "resourceId",metadata,created_at AS "createdAt" FROM schemaops.audit_events ${tenantId ? 'WHERE tenant_id=$1' : ''} ORDER BY created_at DESC LIMIT $${tenantId ? 2 : 1}`, tenantId ? [tenantId, limit] : [limit]);
    return result.rows as AuditEvent[];
  }
  async createSnapshot(input: CreateSnapshotInput): Promise<SourceSnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const snapshotResult = await client.query(`INSERT INTO schemaops.source_snapshots (project_id,git_ref,commit_sha,source_fingerprint,status,error_message,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,project_id AS "projectId",git_ref AS "gitRef",commit_sha AS "commitSha",source_fingerprint AS "sourceFingerprint",status,error_message AS "errorMessage",created_by AS "createdBy",created_at AS "createdAt"`, [input.projectId,input.gitRef,input.commitSha,input.sourceFingerprint,input.status,input.errorMessage ?? null,input.createdBy]);
      const snapshot = snapshotResult.rows[0] as SourceSnapshot;
      for (const file of input.files) await client.query(`INSERT INTO schemaops.migration_files (snapshot_id,path,kind,version,description,checksum,sql_payload) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [snapshot.id,file.path,file.kind,file.version ?? null,file.description,file.checksum,file.sqlPayload]);
      await client.query('COMMIT');
      return snapshot;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async getLatestSnapshot(projectId: string, gitRef?: string): Promise<SourceSnapshot | undefined> {
    const result = await this.pool.query(`SELECT id,project_id AS "projectId",git_ref AS "gitRef",commit_sha AS "commitSha",source_fingerprint AS "sourceFingerprint",status,error_message AS "errorMessage",created_by AS "createdBy",created_at AS "createdAt" FROM schemaops.source_snapshots WHERE project_id=$1 ${gitRef ? 'AND git_ref=$2' : ''} ORDER BY created_at DESC LIMIT 1`, gitRef ? [projectId,gitRef] : [projectId]);
    return result.rows[0] as SourceSnapshot | undefined;
  }
  async listMigrationFiles(snapshotId: string): Promise<MigrationFile[]> {
    const result = await this.pool.query(`SELECT id,snapshot_id AS "snapshotId",path,kind,version,description,checksum,sql_payload AS "sqlPayload",created_at AS "createdAt" FROM schemaops.migration_files WHERE snapshot_id=$1 ORDER BY kind,version,path`, [snapshotId]);
    return result.rows as MigrationFile[];
  }
  async listLedger(targetId: string): Promise<LedgerEntry[]> {
    const result = await this.pool.query(`SELECT id,target_id AS "targetId",source_type AS "sourceType",migration_file_id AS "migrationFileId",path,kind,version,description,checksum,state,out_of_order AS "outOfOrder",execution_sequence AS "executionSequence",operation_id AS "operationId",actor_id AS "actorId",duration_ms AS "durationMs",error_message AS "errorMessage",applied_at AS "appliedAt" FROM schemaops.migration_ledger WHERE target_id=$1 ORDER BY applied_at`, [targetId]);
    return result.rows as LedgerEntry[];
  }
  async appendLedger(entry: Omit<LedgerEntry, 'id'>): Promise<LedgerEntry> { const result=await this.pool.query(`INSERT INTO schemaops.migration_ledger (target_id,source_type,migration_file_id,path,kind,version,description,checksum,state,out_of_order,execution_sequence,operation_id,actor_id,duration_ms,error_message,applied_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id,target_id AS "targetId",source_type AS "sourceType",migration_file_id AS "migrationFileId",path,kind,version,description,checksum,state,out_of_order AS "outOfOrder",execution_sequence AS "executionSequence",operation_id AS "operationId",actor_id AS "actorId",duration_ms AS "durationMs",error_message AS "errorMessage",applied_at AS "appliedAt"`,[entry.targetId,entry.sourceType,entry.migrationFileId??null,entry.path,entry.kind,entry.version??null,entry.description,entry.checksum,entry.state,entry.outOfOrder,entry.executionSequence,entry.operationId??null,entry.actorId,entry.durationMs??null,entry.errorMessage??null,entry.appliedAt]); return result.rows[0] as LedgerEntry; }
  async acquireTargetLock(targetId: string, operationId: string, holderId: string): Promise<boolean> { const result=await this.pool.query(`INSERT INTO schemaops.target_locks (target_id,operation_id,holder_id) VALUES ($1,$2,$3) ON CONFLICT (target_id) DO NOTHING`,[targetId,operationId,holderId]); return result.rowCount===1; }
  async releaseTargetLock(targetId: string, operationId: string): Promise<void> { await this.pool.query(`DELETE FROM schemaops.target_locks WHERE target_id=$1 AND operation_id=$2`,[targetId,operationId]); }
  async listInventory(targetId: string): Promise<InventoryItem[]> {
    const target = await this.getTarget(targetId); if (!target) return [];
    const project = await this.pool.query('SELECT project_id AS "projectId" FROM schemaops.targets WHERE id=$1', [targetId]);
    const snapshot = await this.getLatestSnapshot(project.rows[0]?.projectId as string, target.gitRef);
    if (!snapshot) return [];
    const files = await this.listMigrationFiles(snapshot.id); const ledger = await this.listLedger(targetId);
    return files.map((file) => { const applied = [...ledger].reverse().find((entry) => entry.path === file.path && entry.state === 'APPLIED'); const previous = [...ledger].reverse().find((entry) => entry.path === file.path); return { migrationFileId:file.id,path:file.path,kind:file.kind,version:file.version,description:file.description,checksum:file.checksum,status:previous?.state === 'FAILED' ? 'FAILED' : applied && applied.checksum === file.checksum ? (file.kind === 'REPEATABLE' ? 'REPEATABLE' : 'APPLIED') : applied ? 'CHANGED' : 'PENDING',appliedAt:applied?.appliedAt,executionSequence:applied?.executionSequence,outOfOrder:applied?.outOfOrder,sourceSnapshotId:snapshot.id }; });
  }
  async createPlan(input: CreatePlanInput): Promise<MigrationPlan> {
    const client = await this.pool.connect(); try { await client.query('BEGIN'); const result = await client.query(`INSERT INTO schemaops.migration_plans (target_id,snapshot_id,from_version,to_version,status,fingerprint,auto_approve,created_by,approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,target_id AS "targetId",snapshot_id AS "snapshotId",from_version AS "fromVersion",to_version AS "toVersion",status,fingerprint,auto_approve AS "autoApprove",created_by AS "createdBy",approved_by AS "approvedBy",created_at AS "createdAt",updated_at AS "updatedAt"`, [input.targetId,input.snapshotId ?? null,input.fromVersion ?? null,input.toVersion ?? null,input.status,input.fingerprint,input.autoApprove,input.createdBy,input.approvedBy ?? null]); const plan = result.rows[0] as MigrationPlan; plan.items=[]; for (const item of input.items) { const itemResult = await client.query(`INSERT INTO schemaops.migration_plan_items (plan_id,migration_file_id,source_type,path,kind,version,checksum,execution_sequence,out_of_order,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,plan_id AS "planId",migration_file_id AS "migrationFileId",source_type AS "sourceType",path,kind,version,checksum,execution_sequence AS "executionSequence",out_of_order AS "outOfOrder",status`, [plan.id,item.migrationFileId ?? null,item.sourceType,item.path,item.kind,item.version ?? null,item.checksum,item.executionSequence,item.outOfOrder,item.status]); plan.items.push(itemResult.rows[0] as MigrationPlanItem); } await client.query('COMMIT'); return plan; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async getPlan(id: string): Promise<MigrationPlan | undefined> { const result=await this.pool.query(`SELECT id,target_id AS "targetId",snapshot_id AS "snapshotId",from_version AS "fromVersion",to_version AS "toVersion",status,fingerprint,auto_approve AS "autoApprove",created_by AS "createdBy",approved_by AS "approvedBy",created_at AS "createdAt",updated_at AS "updatedAt" FROM schemaops.migration_plans WHERE id=$1`,[id]); if(!result.rows[0]) return undefined; const plan=result.rows[0] as MigrationPlan; const items=await this.pool.query(`SELECT id,plan_id AS "planId",migration_file_id AS "migrationFileId",source_type AS "sourceType",path,kind,version,checksum,execution_sequence AS "executionSequence",out_of_order AS "outOfOrder",status FROM schemaops.migration_plan_items WHERE plan_id=$1 ORDER BY execution_sequence`,[id]); plan.items=items.rows as MigrationPlanItem[]; return plan; }
  async listPlans(targetId?: string): Promise<MigrationPlan[]> { const result=await this.pool.query(`SELECT id,target_id AS "targetId",snapshot_id AS "snapshotId",from_version AS "fromVersion",to_version AS "toVersion",status,fingerprint,auto_approve AS "autoApprove",created_by AS "createdBy",approved_by AS "approvedBy",created_at AS "createdAt",updated_at AS "updatedAt" FROM schemaops.migration_plans ${targetId?'WHERE target_id=$1':''} ORDER BY created_at DESC`,targetId?[targetId]:[]); const plans:MigrationPlan[]=[]; for(const row of result.rows as MigrationPlan[]) { const plan=await this.getPlan(row.id); if(plan) plans.push(plan); } return plans; }
  async approvePlan(planId: string, actorId: string, decision: 'APPROVED' | 'REJECTED', reason?: string): Promise<MigrationPlan | undefined> { const result=await this.pool.query(`UPDATE schemaops.migration_plans SET status=$2,approved_by=$3,updated_at=now() WHERE id=$1 RETURNING id`,[planId,decision==='APPROVED'?'APPROVED':'REJECTED',actorId]); if(!result.rowCount) return undefined; await this.pool.query(`INSERT INTO schemaops.approvals (plan_id,actor_id,decision,reason) VALUES ($1,$2,$3,$4)`,[planId,actorId,decision,reason??null]); return this.getPlan(planId); }
  async createOperation(input: Omit<Operation, 'id' | 'createdAt'>): Promise<Operation> { const result=await this.pool.query(`INSERT INTO schemaops.operations (target_id,plan_id,type,status,actor_id,correlation_id,started_at,finished_at,error_message) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,target_id AS "targetId",plan_id AS "planId",type,status,actor_id AS "actorId",correlation_id AS "correlationId",created_at AS "createdAt",started_at AS "startedAt",finished_at AS "finishedAt",error_message AS "errorMessage"`,[input.targetId,input.planId??null,input.type,input.status,input.actorId,input.correlationId,input.startedAt??null,input.finishedAt??null,input.errorMessage??null]); return result.rows[0] as Operation; }
  async updateOperation(id: string, patch: Partial<Pick<Operation, 'status'|'startedAt'|'finishedAt'|'errorMessage'>>): Promise<Operation|undefined> { const fields: string[]=[]; const values: unknown[]=[id]; for(const [key,value] of Object.entries(patch)){ const column=key.replace(/[A-Z]/g,(letter)=>`_${letter.toLowerCase()}`); fields.push(`${column}=$${values.length+1}`); values.push(value??null); } if(!fields.length) return this.getOperation(id); const result=await this.pool.query(`UPDATE schemaops.operations SET ${fields.join(',')} WHERE id=$1 RETURNING id,target_id AS "targetId",plan_id AS "planId",type,status,actor_id AS "actorId",correlation_id AS "correlationId",created_at AS "createdAt",started_at AS "startedAt",finished_at AS "finishedAt",error_message AS "errorMessage"`,values); return result.rows[0] as Operation|undefined; }
  private async getOperation(id:string):Promise<Operation|undefined>{ const rows=await this.pool.query(`SELECT id,target_id AS "targetId",plan_id AS "planId",type,status,actor_id AS "actorId",correlation_id AS "correlationId",created_at AS "createdAt",started_at AS "startedAt",finished_at AS "finishedAt",error_message AS "errorMessage" FROM schemaops.operations WHERE id=$1`,[id]); return rows.rows[0] as Operation|undefined; }
  async listOperations(targetId?: string): Promise<Operation[]> { const result=await this.pool.query(`SELECT id,target_id AS "targetId",plan_id AS "planId",type,status,actor_id AS "actorId",correlation_id AS "correlationId",created_at AS "createdAt",started_at AS "startedAt",finished_at AS "finishedAt",error_message AS "errorMessage" FROM schemaops.operations ${targetId?'WHERE target_id=$1':''} ORDER BY created_at DESC`,targetId?[targetId]:[]); return result.rows as Operation[]; }
  async appendExecutionLog(input: ExecutionLog): Promise<void> { await this.pool.query(`INSERT INTO schemaops.execution_logs (operation_id,operation_item_id,sequence,stream,message,redacted,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,[input.operationId,input.operationItemId??null,input.sequence,input.stream,input.message,input.redacted,input.createdAt]); }
  async listExecutionLogs(operationId: string): Promise<ExecutionLog[]> { const result=await this.pool.query(`SELECT operation_id AS "operationId",operation_item_id AS "operationItemId",sequence,stream,message,redacted,created_at AS "createdAt" FROM schemaops.execution_logs WHERE operation_id=$1 ORDER BY sequence`,[operationId]); return result.rows as ExecutionLog[]; }
}
