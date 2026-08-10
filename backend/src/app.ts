import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { z } from 'zod';
import { checksumSql, databaseEngines } from './domain.js';
import type { Store } from './store.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor?: { id: string; claims: JWTPayload };
  }
}

const projectSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(120),
  databaseEngine: z.enum(databaseEngines),
  repositoryUrl: z.string().url(),
  defaultRef: z.string().min(1).max(200).default('master'),
  migrationPath: z.string().min(1).max(300).default('migrations'),
});

const targetSchema = z.object({
  projectId: z.string().uuid(),
  environmentId: z.string().uuid(),
  name: z.string().min(1).max(120),
  gitRef: z.string().min(1).max(200).default('master'),
  databaseName: z.string().min(1).max(200),
  schemaName: z.string().min(1).max(200),
  secretRef: z.string().min(1).max(300),
});

const manualMigrationSchema = z.object({
  sqlPayload: z.string().trim().min(1).max(1_000_000),
  versionContext: z.string().max(120).optional(),
  executionLabel: z.string().max(200).optional(),
  executionSequence: z.number().int().positive().optional(),
  outOfOrder: z.boolean().default(false),
  reason: z.string().max(1_000).optional(),
});

function actorId(request: { actor?: { id: string }; headers: Record<string, string | string[] | undefined> }): string {
  if (request.actor?.id) return request.actor.id;
  const configured = request.headers['x-actor-id'];
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  return 'local-development';
}

export async function buildApp(store: Store): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  const corsOrigins = process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean);
  await app.register(cors, { origin: process.env.NODE_ENV === 'production' ? (corsOrigins ?? false) : true });

  const authMode = process.env.AUTH_MODE ?? (process.env.NODE_ENV === 'production' ? 'oidc' : 'mock');
  let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
  if (authMode === 'oidc') {
    const jwksUrl = process.env.OIDC_JWKS_URL;
    if (!jwksUrl) throw new Error('OIDC_JWKS_URL is required when AUTH_MODE=oidc');
    jwks = createRemoteJWKSet(new URL(jwksUrl));
  }

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/v1') || authMode === 'mock') return;
    if (authMode !== 'oidc' || !jwks) return reply.code(503).send({ code: 'AUTH_NOT_CONFIGURED' });
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) return reply.code(401).send({ code: 'UNAUTHENTICATED' });
    try {
      const verified = await jwtVerify(authorization.slice('Bearer '.length), jwks, {
        issuer: process.env.OIDC_ISSUER,
        audience: process.env.OIDC_AUDIENCE,
      });
      request.actor = { id: verified.payload.sub ?? 'unknown-subject', claims: verified.payload };
    } catch (error) {
      request.log.warn({ err: error }, 'OIDC token verification failed');
      return reply.code(401).send({ code: 'INVALID_TOKEN' });
    }
  });

  app.get('/health', async () => ({ status: 'ok', service: 'schemaops-backend' }));
  app.get('/ready', async (_request, reply) => {
    try {
      await store.ready();
      return { status: 'ready' };
    } catch (error) {
      app.log.error({ err: error }, 'control-plane database is not ready');
      return reply.code(503).send({ status: 'not_ready' });
    }
  });

  app.post('/api/v1/projects', async (request, reply) => {
    const parsed = projectSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    const project = await store.createProject(parsed.data);
    return reply.code(201).send(project);
  });

  app.post('/api/v1/targets', async (request, reply) => {
    const parsed = targetSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    const target = await store.createTarget(parsed.data);
    return reply.code(201).send(target);
  });

  app.post('/api/v1/targets/:targetId/manual-migrations', async (request, reply) => {
    const targetId = z.string().uuid().safeParse((request.params as { targetId?: string }).targetId);
    const parsed = manualMigrationSchema.safeParse(request.body);
    if (!targetId.success || !parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', details: parsed.success ? 'invalid targetId' : parsed.error.flatten() });
    }
    const target = await store.getTarget(targetId.data);
    if (!target) return reply.code(404).send({ code: 'TARGET_NOT_FOUND' });
    const migration = await store.createManualMigration({
      targetId: target.id,
      sourceType: 'MANUAL_UI',
      sqlPayload: parsed.data.sqlPayload,
      checksum: checksumSql(parsed.data.sqlPayload),
      versionContext: parsed.data.versionContext,
      executionLabel: parsed.data.executionLabel,
      executionSequence: parsed.data.executionSequence,
      outOfOrder: parsed.data.outOfOrder,
      reason: parsed.data.reason,
      actorId: actorId(request),
      status: 'DRAFT',
    });
    const { sqlPayload: _sqlPayload, ...metadata } = migration;
    await store.recordTargetAudit({
      targetId: target.id,
      actorId: migration.actorId,
      action: 'manual_migration.created',
      resourceType: 'manual_migration',
      resourceId: migration.id,
      metadata: {
        sourceType: migration.sourceType,
        checksum: migration.checksum,
        versionContext: migration.versionContext,
        executionSequence: migration.executionSequence,
        outOfOrder: migration.outOfOrder,
        status: migration.status,
      },
    });
    return reply.code(201).send(metadata);
  });

  app.get('/api/v1/targets/:targetId/manual-migrations', async (request, reply) => {
    const targetId = z.string().uuid().safeParse((request.params as { targetId?: string }).targetId);
    if (!targetId.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const target = await store.getTarget(targetId.data);
    if (!target) return reply.code(404).send({ code: 'TARGET_NOT_FOUND' });
    const migrations = await store.listManualMigrations(target.id);
    return { items: migrations.map(({ sqlPayload: _sqlPayload, ...metadata }) => metadata) };
  });

  return app;
}
