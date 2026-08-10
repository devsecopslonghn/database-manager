import { createDatabaseAdapter, type SecretResolver } from './database-adapters.js';
import { KubernetesConnectionSecretStore } from './secret-store.js';
import type { Store } from './store.js';

function timestamp(): string { return new Date().toISOString(); }

async function backupGate(store: Store, targetId: string): Promise<void> {
  const backupPlan = await store.getBackupPlan(targetId);
  if (!backupPlan || backupPlan.requiredBeforeExecute) {
    const artifacts = await store.listBackupArtifacts(targetId);
    if (!artifacts.some((artifact) => artifact.status === 'SUCCEEDED')) throw new Error('BACKUP_ARTIFACT_REQUIRED');
  }
}

export async function executeOperation(store: Store, operationId: string, resolver: SecretResolver = new KubernetesConnectionSecretStore()): Promise<void> {
  const operation = (await store.listOperations()).find((item) => item.id === operationId);
  if (!operation) return;
  if (operation.type === 'UNDO') { await executeUndoOperation(store, operation, resolver); return; }
  if (!operation.planId) return;
  const plan = await store.getPlan(operation.planId); const target = await store.getTarget(operation.targetId); if (!plan || !target) return;
  const project = await store.getProject(target.projectId); if (!project) return;
  const locked = await store.acquireTargetLock(target.id, operation.id, operation.actorId);
  if (!locked) { await store.updateOperation(operation.id,{status:'FAILED',finishedAt:timestamp(),errorMessage:'TARGET_LOCK_UNAVAILABLE'}); await store.appendExecutionLog({operationId:operation.id,sequence:2,stream:'stderr',message:'Execution blocked: another operation holds the target lock.',redacted:true,createdAt:timestamp()}); return; }
  let adapter: Awaited<ReturnType<typeof createDatabaseAdapter>> | undefined;
  let sequence = 3;
  try {
    await store.updateOperation(operation.id,{status:'RUNNING',startedAt:timestamp()}); await store.updatePlanStatus(plan.id, 'EXECUTING');
    await backupGate(store, target.id);
    const connection = await resolver.resolve(target.secretRef,target.id); if (!connection) throw new Error('TARGET_CONNECTION_NOT_AVAILABLE');
    adapter = await createDatabaseAdapter(project.databaseEngine,connection); await adapter.begin();
    const snapshot = plan.snapshotId ? await store.getSnapshot(plan.snapshotId) : undefined; const files = snapshot?.status === 'SUCCEEDED' ? await store.listMigrationFiles(snapshot.id) : [];
    if (plan.snapshotId && (!snapshot || snapshot.status !== 'SUCCEEDED')) throw new Error('PLAN_SOURCE_SNAPSHOT_NOT_AVAILABLE');
    for (const item of plan.items) {
      const manual = item.sourceType === 'MANUAL_UI' && item.manualMigrationId ? await store.getManualMigration(item.manualMigrationId) : undefined;
      const file = item.sourceType === 'GIT' ? files.find((candidate)=>candidate.id===item.migrationFileId || candidate.path===item.path) : undefined;
      if (item.sourceType === 'GIT' && !file) throw new Error(`MIGRATION_FILE_NOT_FOUND:${item.path}`);
      if (item.sourceType === 'MANUAL_UI' && !manual) throw new Error(`MANUAL_MIGRATION_NOT_FOUND:${item.manualMigrationId ?? item.path}`);
      await store.appendExecutionLog({operationId:operation.id,sequence:sequence++,stream:'system',message:`Executing ${item.executionSequence}: ${item.path}`,redacted:true,createdAt:timestamp()});
      const result=await adapter.execute(file?.sqlPayload ?? manual!.sqlPayload);
      await store.appendLedger({targetId:target.id,sourceType:item.sourceType,migrationFileId:file?.id,path:file?.path ?? manual!.executionLabel ?? item.path,kind:file?.kind ?? 'MANUAL',version:file?.version ?? manual!.versionContext,description:file?.description ?? manual!.executionLabel ?? 'Manual SQL',checksum:file?.checksum ?? manual!.checksum,state:'APPLIED',outOfOrder:item.outOfOrder,executionSequence:item.executionSequence,operationId:operation.id,actorId:operation.actorId,durationMs:result.durationMs,appliedAt:timestamp()});
    }
    await adapter.commit(); await store.updatePlanStatus(plan.id, 'SUCCEEDED'); await store.updateOperation(operation.id,{status:'SUCCEEDED',finishedAt:timestamp()});
    await store.appendExecutionLog({operationId:operation.id,sequence,stream:'system',message:'Transaction committed; ledger persisted.',redacted:true,createdAt:timestamp()});
    await store.recordTargetAudit({targetId:target.id,actorId:operation.actorId,action:'migration_operation.succeeded',resourceType:'operation',resourceId:operation.id,metadata:{planId:plan.id,itemCount:plan.items.length}});
  } catch (error) {
    await adapter?.rollback(); const message=error instanceof Error?error.message:'EXECUTION_FAILED'; await store.updatePlanStatus(plan.id, 'FAILED'); await store.updateOperation(operation.id,{status:'FAILED',finishedAt:timestamp(),errorMessage:message});
    await store.appendExecutionLog({operationId:operation.id,sequence,stream:'stderr',message,redacted:true,createdAt:timestamp()}); await store.recordTargetAudit({targetId:target.id,actorId:operation.actorId,action:'migration_operation.failed',resourceType:'operation',resourceId:operation.id,metadata:{planId:plan.id,error:message}});
  } finally { await adapter?.close(); await store.releaseTargetLock(target.id,operation.id); }
}

async function executeUndoOperation(store: Store, operation: import('./domain.js').Operation, resolver: SecretResolver): Promise<void> {
  if (!operation.sourceOperationId) return;
  const source = (await store.listOperations()).find((item) => item.id === operation.sourceOperationId); const plan = source?.planId ? await store.getPlan(source.planId) : undefined; const target = await store.getTarget(operation.targetId); if (!source || !plan || !target) return;
  const project = await store.getProject(target.projectId); if (!project) return;
  const locked = await store.acquireTargetLock(target.id, operation.id, operation.actorId); if (!locked) { await store.updateOperation(operation.id,{status:'FAILED',finishedAt:timestamp(),errorMessage:'TARGET_LOCK_UNAVAILABLE'}); return; }
  let adapter: Awaited<ReturnType<typeof createDatabaseAdapter>> | undefined; let sequence = 2;
  try {
    await store.updateOperation(operation.id,{status:'RUNNING',startedAt:timestamp()}); await backupGate(store,target.id);
    const connection=await resolver.resolve(target.secretRef,target.id); if(!connection) throw new Error('TARGET_CONNECTION_NOT_AVAILABLE');
    adapter=await createDatabaseAdapter(project.databaseEngine,connection); await adapter.begin();
    const snapshot=plan.snapshotId?await store.getSnapshot(plan.snapshotId):undefined; const files=snapshot?.status==='SUCCEEDED'?await store.listMigrationFiles(snapshot.id):[];
    if (plan.snapshotId && (!snapshot || snapshot.status !== 'SUCCEEDED')) throw new Error('PLAN_SOURCE_SNAPSHOT_NOT_AVAILABLE');
    const applied=(await store.listLedger(target.id)).filter((entry)=>entry.operationId===source.id&&entry.state==='APPLIED'&&entry.kind==='VERSIONED').sort((a,b)=>b.executionSequence-a.executionSequence);
    if(!applied.length) throw new Error('UNDO_NOTHING_TO_ROLLBACK');
    for(const entry of applied){ const undo=files.find((file)=>file.kind==='UNDO'&&file.version===entry.version); if(!undo) throw new Error(`UNDO_SCRIPT_NOT_FOUND:${entry.version ?? entry.path}`); await store.appendExecutionLog({operationId:operation.id,sequence:sequence++,stream:'system',message:`Undoing ${entry.path} with ${undo.path}`,redacted:true,createdAt:timestamp()}); const result=await adapter.execute(undo.sqlPayload); await store.appendLedger({targetId:target.id,sourceType:'GIT',migrationFileId:entry.migrationFileId,path:entry.path,kind:entry.kind,version:entry.version,description:entry.description,checksum:entry.checksum,state:'ROLLED_BACK',outOfOrder:entry.outOfOrder,executionSequence:entry.executionSequence,operationId:operation.id,actorId:operation.actorId,durationMs:result.durationMs,appliedAt:timestamp()}); await store.appendLedger({targetId:target.id,sourceType:'GIT',migrationFileId:undo.id,path:undo.path,kind:'UNDO',version:undo.version,description:undo.description,checksum:undo.checksum,state:'APPLIED',outOfOrder:false,executionSequence:entry.executionSequence,operationId:operation.id,actorId:operation.actorId,durationMs:result.durationMs,appliedAt:timestamp()}); }
    await adapter.commit(); await store.updateOperation(operation.id,{status:'SUCCEEDED',finishedAt:timestamp()}); await store.appendExecutionLog({operationId:operation.id,sequence,stream:'system',message:'Undo transaction committed; original ledger remains immutable.',redacted:true,createdAt:timestamp()}); await store.recordTargetAudit({targetId:target.id,actorId:operation.actorId,action:'rollback.undo.succeeded',resourceType:'operation',resourceId:operation.id,metadata:{sourceOperationId:source.id}});
  } catch(error) { await adapter?.rollback(); const message=error instanceof Error?error.message:'UNDO_FAILED'; await store.updateOperation(operation.id,{status:'FAILED',finishedAt:timestamp(),errorMessage:message}); await store.appendExecutionLog({operationId:operation.id,sequence,stream:'stderr',message,redacted:true,createdAt:timestamp()}); await store.recordTargetAudit({targetId:target.id,actorId:operation.actorId,action:'rollback.undo.failed',resourceType:'operation',resourceId:operation.id,metadata:{sourceOperationId:source.id,error:message}}); }
  finally { await adapter?.close(); await store.releaseTargetLock(target.id,operation.id); }
}
