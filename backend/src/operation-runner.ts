import { createDatabaseAdapter, MountedSecretResolver, type SecretResolver } from './database-adapters.js';
import type { Store } from './store.js';

export async function executeOperation(store: Store, operationId: string, resolver: SecretResolver = new MountedSecretResolver()): Promise<void> {
  const operation = (await store.listOperations()).find((item) => item.id === operationId);
  if (!operation || !operation.planId) return;
  const plan = await store.getPlan(operation.planId); const target = await store.getTarget(operation.targetId); if (!plan || !target) return;
  const project = await store.getProject(target.projectId); if (!project) return;
  const locked = await store.acquireTargetLock(target.id, operation.id, operation.actorId);
  if (!locked) { await store.updateOperation(operation.id,{status:'FAILED',finishedAt:new Date().toISOString(),errorMessage:'TARGET_LOCK_UNAVAILABLE'}); await store.appendExecutionLog({operationId:operation.id,sequence:2,stream:'stderr',message:'Execution blocked: another operation holds the target lock.',redacted:true,createdAt:new Date().toISOString()}); return; }
  let adapter: Awaited<ReturnType<typeof createDatabaseAdapter>> | undefined;
  try {
    await store.updateOperation(operation.id,{status:'RUNNING',startedAt:new Date().toISOString()});
    const connection = await resolver.resolve(target.secretRef,target.id);
    if (!connection) throw new Error('TARGET_CONNECTION_NOT_AVAILABLE');
    adapter = await createDatabaseAdapter(project.databaseEngine,connection);
    await adapter.begin();
    const snapshot = await store.getLatestSnapshot(project.id,target.gitRef); const files = snapshot ? await store.listMigrationFiles(snapshot.id) : [];
    let sequence=3;
    for (const item of plan.items) {
      const file = files.find((candidate)=>candidate.id===item.migrationFileId || candidate.path===item.path);
      if (!file) throw new Error(`MIGRATION_FILE_NOT_FOUND:${item.path}`);
      await store.appendExecutionLog({operationId:operation.id,sequence:sequence++,stream:'system',message:`Executing ${item.executionSequence}: ${item.path}`,redacted:true,createdAt:new Date().toISOString()});
      const result=await adapter.execute(file.sqlPayload);
      await store.appendLedger({targetId:target.id,sourceType:'GIT',migrationFileId:file.id,path:file.path,kind:file.kind,version:file.version,description:file.description,checksum:file.checksum,state:'APPLIED',outOfOrder:item.outOfOrder,executionSequence:item.executionSequence,operationId:operation.id,actorId:operation.actorId,durationMs:result.durationMs,appliedAt:new Date().toISOString()});
    }
    await adapter.commit();
    await store.updateOperation(operation.id,{status:'SUCCEEDED',finishedAt:new Date().toISOString()});
    await store.appendExecutionLog({operationId:operation.id,sequence:sequence,stream:'system',message:'Transaction committed; ledger persisted.',redacted:true,createdAt:new Date().toISOString()});
    await store.recordTargetAudit({targetId:target.id,actorId:operation.actorId,action:'migration_operation.succeeded',resourceType:'operation',resourceId:operation.id,metadata:{planId:plan.id,itemCount:plan.items.length}});
  } catch (error) {
    await adapter?.rollback(); const message=error instanceof Error?error.message:'EXECUTION_FAILED';
    await store.updateOperation(operation.id,{status:'FAILED',finishedAt:new Date().toISOString(),errorMessage:message});
    await store.appendExecutionLog({operationId:operation.id,sequence:999999,stream:'stderr',message,redacted:true,createdAt:new Date().toISOString()});
    await store.recordTargetAudit({targetId:target.id,actorId:operation.actorId,action:'migration_operation.failed',resourceType:'operation',resourceId:operation.id,metadata:{planId:plan.id,error:message}});
  } finally { await adapter?.close(); await store.releaseTargetLock(target.id,operation.id); }
}
