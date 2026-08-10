import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { checksumSql, databaseEngines, type Actor } from './domain.js';
import { syncProjectSource } from './git-source.js';
import { actorFromClaims, AuthorizationError, requirePermission } from './rbac.js';
import { buildPlan } from './planner.js';
import { executeOperation } from './operation-runner.js';
import type { Store } from './store.js';

declare module 'fastify' {
  interface FastifyRequest { actor?: Actor; claims?: JWTPayload; }
}

const uuid = z.string().uuid();
const projectSchema = z.object({ tenantId: uuid, name: z.string().trim().min(1).max(120), databaseEngine: z.enum(databaseEngines), repositoryUrl: z.string().url(), defaultRef: z.string().trim().min(1).max(200).default('master'), migrationPath: z.string().trim().min(1).max(300).default('migrations') });
const environmentSchema = z.object({ projectId: uuid, name: z.string().trim().min(1).max(80) });
const targetSchema = z.object({ projectId: uuid, environmentId: uuid, name: z.string().trim().min(1).max(120), gitRef: z.string().trim().min(1).max(200).default('master'), databaseName: z.string().trim().min(1).max(200), schemaName: z.string().trim().min(1).max(200), secretRef: z.string().trim().min(1).max(300) });
const manualMigrationSchema = z.object({ sqlPayload: z.string().trim().min(1).max(1_000_000), versionContext: z.string().max(120).optional(), executionLabel: z.string().max(200).optional(), executionSequence: z.number().int().positive().optional(), outOfOrder: z.boolean().default(false), reason: z.string().max(1_000).optional() });
const planSchema = z.object({ fromVersion: z.string().max(120).optional(), toVersion: z.string().max(120).optional(), autoApprove: z.boolean().default(false) });
const approvalSchema = z.object({ decision: z.enum(['APPROVED', 'REJECTED']), reason: z.string().max(1_000).optional() });

function actorFor(request: { actor?: Actor; headers: Record<string, string | string[] | undefined> }): Actor {
  if (request.actor) return request.actor;
  const configured = request.headers['x-actor-id'];
  return { id: typeof configured === 'string' && configured.trim() ? configured.trim() : 'local-development', roles: ['TENANT_ADMIN'] };
}
function params(request: { params: unknown }): Record<string, string | undefined> { return request.params as Record<string, string | undefined>; }
function sendValidation(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, parsed: { success: boolean; error?: unknown }) { return reply.code(400).send({ code: 'VALIDATION_ERROR', details: parsed.success ? undefined : parsed.error }); }

export async function buildApp(store: Store): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  const corsOrigins = process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean);
  await app.register(cors, { origin: process.env.NODE_ENV === 'production' ? (corsOrigins ?? false) : true });
  const authMode = process.env.AUTH_MODE ?? (process.env.NODE_ENV === 'production' ? 'oidc' : 'mock');
  let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
  if (authMode === 'oidc') { const jwksUrl = process.env.OIDC_JWKS_URL; if (!jwksUrl) throw new Error('OIDC_JWKS_URL is required when AUTH_MODE=oidc'); jwks = createRemoteJWKSet(new URL(jwksUrl)); }

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/v1') || authMode === 'mock') return;
    if (!jwks) return reply.code(503).send({ code: 'AUTH_NOT_CONFIGURED' });
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) return reply.code(401).send({ code: 'UNAUTHENTICATED' });
    try {
      const verified = await jwtVerify(authorization.slice('Bearer '.length), jwks, { issuer: process.env.OIDC_ISSUER, audience: process.env.OIDC_AUDIENCE });
      request.claims = verified.payload;
      request.actor = actorFromClaims(verified.payload.sub ?? 'unknown-subject', verified.payload as Record<string, unknown>);
    } catch (error) { request.log.warn({ err: error }, 'OIDC token verification failed'); return reply.code(401).send({ code: 'INVALID_TOKEN' }); }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AuthorizationError) return reply.code(403).send({ code: error.code, message: error.message });
    request.log.error({ err: error }, 'request failed');
    return reply.code(500).send({ code: 'INTERNAL_ERROR', correlationId: request.id });
  });
  app.get('/health', async () => ({ status: 'ok', service: 'schemaops-backend' }));
  app.get('/ready', async (_request, reply) => { try { await store.ready(); return { status: 'ready' }; } catch (error) { app.log.error({ err: error }, 'control-plane database is not ready'); return reply.code(503).send({ status: 'not_ready' }); } });

  app.get('/api/v1/dashboard', async (request) => {
    const actor = actorFor(request); requirePermission(actor, 'target:view');
    const [projects, targets, operations, audit] = await Promise.all([store.listProjects(), store.listTargets(), store.listOperations(), store.listAuditEvents(undefined, 10)]);
    return { metrics: { projects: projects.length, targets: targets.length, pendingMigrations: 0, failedRuns: operations.filter((o) => o.status === 'FAILED').length }, projects, targets, operations: operations.slice(0, 10), audit };
  });

  app.get('/api/v1/projects', async (request) => { requirePermission(actorFor(request), 'target:view'); return { items: await store.listProjects() }; });
  app.post('/api/v1/projects', async (request, reply) => { const actor=actorFor(request); requirePermission(actor, 'access:admin'); const parsed=projectSchema.safeParse(request.body); if(!parsed.success) return sendValidation(reply,parsed); return reply.code(201).send(await store.createProject(parsed.data)); });
  app.get('/api/v1/projects/:projectId/environments', async (request, reply) => { const projectId=uuid.safeParse(params(request).projectId); if(!projectId.success) return reply.code(400).send({code:'VALIDATION_ERROR'}); requirePermission(actorFor(request),'target:view'); return {items:await store.listEnvironments(projectId.data)}; });
  app.post('/api/v1/environments', async (request, reply) => { const actor=actorFor(request); requirePermission(actor,'access:admin'); const parsed=environmentSchema.safeParse(request.body); if(!parsed.success) return sendValidation(reply,parsed); return reply.code(201).send(await store.createEnvironment(parsed.data)); });

  app.get('/api/v1/targets', async (request) => { requirePermission(actorFor(request), 'target:view'); const projectId=typeof (request.query as {projectId?:unknown})?.projectId==='string' ? (request.query as {projectId:string}).projectId : undefined; return {items:await store.listTargets(projectId)}; });
  app.post('/api/v1/targets', async (request, reply) => { const actor=actorFor(request); requirePermission(actor,'access:admin'); const parsed=targetSchema.safeParse(request.body); if(!parsed.success) return sendValidation(reply,parsed); return reply.code(201).send(await store.createTarget(parsed.data)); });
  app.post('/api/v1/projects/:projectId/sync', async (request, reply) => { const actor=actorFor(request); requirePermission(actor,'target:sync'); const projectId=uuid.safeParse(params(request).projectId); if(!projectId.success) return reply.code(400).send({code:'VALIDATION_ERROR'}); const body=z.object({gitRef:z.string().trim().min(1).max(200).optional()}).safeParse(request.body ?? {}); if(!body.success) return sendValidation(reply,body); const snapshot=await syncProjectSource(store,projectId.data,body.data.gitRef,actor.id); return reply.code(snapshot.status==='SUCCEEDED'?201:422).send(snapshot); });

  app.get('/api/v1/targets/:targetId/inventory', async (request, reply) => { const targetId=uuid.safeParse(params(request).targetId); if(!targetId.success) return reply.code(400).send({code:'VALIDATION_ERROR'}); requirePermission(actorFor(request),'target:view'); const target=await store.getTarget(targetId.data); if(!target) return reply.code(404).send({code:'TARGET_NOT_FOUND'}); return {items:await store.listInventory(target.id)}; });
  app.get('/api/v1/targets/:targetId/ledger', async (request, reply) => { const targetId=uuid.safeParse(params(request).targetId); if(!targetId.success) return reply.code(400).send({code:'VALIDATION_ERROR'}); requirePermission(actorFor(request),'target:view'); return {items:await store.listLedger(targetId.data)}; });

  app.post('/api/v1/targets/:targetId/plans', async (request, reply) => { const actor=actorFor(request); requirePermission(actor,'migration:plan'); const targetId=uuid.safeParse(params(request).targetId); const parsed=planSchema.safeParse(request.body ?? {}); if(!targetId.success||!parsed.success) return reply.code(400).send({code:'VALIDATION_ERROR',details:parsed.success?'invalid targetId':parsed.error.flatten()}); const target=await store.getTarget(targetId.data); if(!target) return reply.code(404).send({code:'TARGET_NOT_FOUND'}); return reply.code(201).send(await buildPlan(store,target.id,actor.id,parsed.data)); });
  app.get('/api/v1/targets/:targetId/plans', async (request, reply) => { const targetId=uuid.safeParse(params(request).targetId); if(!targetId.success) return reply.code(400).send({code:'VALIDATION_ERROR'}); requirePermission(actorFor(request),'target:view'); return {items:await store.listPlans(targetId.data)}; });
  app.get('/api/v1/plans/:planId', async (request, reply) => { const planId=uuid.safeParse(params(request).planId); if(!planId.success) return reply.code(400).send({code:'VALIDATION_ERROR'}); requirePermission(actorFor(request),'target:view'); const plan=await store.getPlan(planId.data); return plan?plan:reply.code(404).send({code:'PLAN_NOT_FOUND'}); });
  app.post('/api/v1/plans/:planId/approval', async (request, reply) => { const actor=actorFor(request); requirePermission(actor,'migration:execute'); const planId=uuid.safeParse(params(request).planId); const parsed=approvalSchema.safeParse(request.body); if(!planId.success||!parsed.success) return reply.code(400).send({code:'VALIDATION_ERROR'}); const plan=await store.approvePlan(planId.data,actor.id,parsed.data.decision,parsed.data.reason); if(!plan) return reply.code(404).send({code:'PLAN_NOT_FOUND'}); await store.recordTargetAudit({targetId:plan.targetId,actorId:actor.id,action:`migration_plan.${parsed.data.decision.toLowerCase()}`,resourceType:'migration_plan',resourceId:plan.id,metadata:{reason:parsed.data.reason}}); return plan; });

  app.post('/api/v1/plans/:planId/execute', async (request, reply) => { const actor=actorFor(request); requirePermission(actor,'migration:execute'); const planId=uuid.safeParse(params(request).planId); if(!planId.success) return reply.code(400).send({code:'VALIDATION_ERROR'}); const plan=await store.getPlan(planId.data); if(!plan) return reply.code(404).send({code:'PLAN_NOT_FOUND'}); if(plan.status!=='APPROVED') return reply.code(409).send({code:'PLAN_NOT_APPROVED',status:plan.status}); const operation=await store.createOperation({targetId:plan.targetId,planId:plan.id,type:'EXECUTE',status:'QUEUED',actorId:actor.id,correlationId:request.id}); await store.appendExecutionLog({operationId:operation.id,sequence:1,stream:'system',message:'Operation queued. Worker execution is fail-closed until target secret and backup policy are configured.',redacted:true,createdAt:new Date().toISOString()}); await store.recordTargetAudit({targetId:plan.targetId,actorId:actor.id,action:'migration_operation.queued',resourceType:'operation',resourceId:operation.id,metadata:{planId:plan.id,itemCount:plan.items.length}}); if(process.env.SCHEMAOPS_OPERATION_WORKER_ENABLED==='true') void executeOperation(store,operation.id); return reply.code(202).send({operationId:operation.id,status:operation.status}); });
  app.get('/api/v1/targets/:targetId/operations', async (request, reply) => { const targetId=uuid.safeParse(params(request).targetId); if(!targetId.success) return reply.code(400).send({code:'VALIDATION_ERROR'}); requirePermission(actorFor(request),'target:view'); return {items:await store.listOperations(targetId.data)}; });
  app.get('/api/v1/operations/:operationId', async (request, reply) => { const operationId=uuid.safeParse(params(request).operationId); if(!operationId.success) return reply.code(400).send({code:'VALIDATION_ERROR'}); requirePermission(actorFor(request),'target:view'); const operations=await store.listOperations(); const operation=operations.find((item)=>item.id===operationId.data); if(!operation) return reply.code(404).send({code:'OPERATION_NOT_FOUND'}); return {...operation,logs:await store.listExecutionLogs(operation.id)}; });
  app.get('/api/v1/audit-events', async (request) => { requirePermission(actorFor(request),'target:view'); return {items:await store.listAuditEvents(undefined,100)}; });

  app.post('/api/v1/targets/:targetId/manual-migrations', async (request, reply) => { const actor=actorFor(request); requirePermission(actor,'migration:plan'); const targetId=uuid.safeParse(params(request).targetId); const parsed=manualMigrationSchema.safeParse(request.body); if(!targetId.success||!parsed.success) return reply.code(400).send({code:'VALIDATION_ERROR',details:parsed.success?'invalid targetId':parsed.error.flatten()}); const target=await store.getTarget(targetId.data); if(!target) return reply.code(404).send({code:'TARGET_NOT_FOUND'}); const migration=await store.createManualMigration({targetId:target.id,sourceType:'MANUAL_UI',sqlPayload:parsed.data.sqlPayload,checksum:checksumSql(parsed.data.sqlPayload),versionContext:parsed.data.versionContext,executionLabel:parsed.data.executionLabel,executionSequence:parsed.data.executionSequence,outOfOrder:parsed.data.outOfOrder,reason:parsed.data.reason,actorId:actor.id,status:'DRAFT'}); const {sqlPayload:_sqlPayload,...metadata}=migration; await store.recordTargetAudit({targetId:target.id,actorId:migration.actorId,action:'manual_migration.created',resourceType:'manual_migration',resourceId:migration.id,metadata:{sourceType:migration.sourceType,checksum:migration.checksum,versionContext:migration.versionContext,executionSequence:migration.executionSequence,outOfOrder:migration.outOfOrder,status:migration.status}}); return reply.code(201).send(metadata); });
  app.get('/api/v1/targets/:targetId/manual-migrations', async (request, reply) => { const targetId=uuid.safeParse(params(request).targetId); if(!targetId.success) return reply.code(400).send({code:'VALIDATION_ERROR'}); requirePermission(actorFor(request),'target:view'); const target=await store.getTarget(targetId.data); if(!target) return reply.code(404).send({code:'TARGET_NOT_FOUND'}); const migrations=await store.listManualMigrations(target.id); return {items:migrations.map(({sqlPayload:_sqlPayload,...metadata})=>metadata)}; });
  return app;
}
