import { CoreV1Api, KubeConfig, type V1Secret } from '@kubernetes/client-node';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { createDatabaseAdapter, type DatabaseAdapter, type SecretResolver, type TargetConnection as AdapterConnection } from './database-adapters.js';
import type { DatabaseEngine, SecretBackend, SslMode } from './domain.js';

export type ConnectionSecret = { engine: DatabaseEngine; host: string; port: number; database: string; schema: string; username: string; password: string; sslMode: SslMode; timeoutSeconds: number };
export type GitCredentials = { username: string; token: string };
export type SecretVersion = { version?: string };
export type ManagedSecretKind = 'DATABASE_CONNECTION' | 'GIT_CREDENTIAL';
export type ManagedSecretMetadata = { secretRef: string; tenantId?: string; kind: ManagedSecretKind; version: number; createdAt: string; updatedAt: string; createdBy: string; updatedBy: string; description?: string };
export type ManagedSecretPayload = ConnectionSecret | GitCredentials;

export interface ManagedSecretStore {
  writeManaged(secretRef: string, kind: ManagedSecretKind, payload: ManagedSecretPayload, actorId: string, description?: string, tenantId?: string): Promise<ManagedSecretMetadata>;
  readGitCredentials(secretRef: string, tenantId?: string): Promise<GitCredentials | undefined>;
  listManaged(tenantId?: string): Promise<ManagedSecretMetadata[]>;
  deleteManaged(secretRef: string): Promise<boolean>;
}

export interface ConnectionSecretStore {
  write(secretRef: string, value: ConnectionSecret, tenantId?: string): Promise<SecretVersion>;
  read(secretRef: string, tenantId?: string): Promise<ConnectionSecret | undefined>;
}

function encode(value: string): string { return Buffer.from(value, 'utf8').toString('base64'); }
function decode(value: string | undefined): string { return value ? Buffer.from(value, 'base64').toString('utf8') : ''; }
function validateSecretName(secretRef: string): void {
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(secretRef) || secretRef.length > 253) throw new Error('INVALID_KUBERNETES_SECRET_NAME');
}

export class KubernetesConnectionSecretStore implements ConnectionSecretStore, SecretResolver {
  private readonly api: CoreV1Api;
  private readonly namespace: string;
  constructor(namespace = process.env.SCHEMAOPS_SECRET_NAMESPACE ?? process.env.POD_NAMESPACE ?? 'database-manager', api?: CoreV1Api) {
    this.namespace = namespace;
    if (api) this.api = api;
    else { const config = new KubeConfig(); if (process.env.KUBERNETES_SERVICE_HOST) config.loadFromCluster(); else config.loadFromDefault(); this.api = config.makeApiClient(CoreV1Api); }
  }

  async write(secretRef: string, value: ConnectionSecret, _tenantId?: string): Promise<SecretVersion> {
    validateSecretName(secretRef);
    const data: Record<string, string> = {};
    for (const [key, raw] of Object.entries({ engine: value.engine, host: value.host, port: String(value.port), database: value.database, schema: value.schema, username: value.username, password: value.password, ssl_mode: value.sslMode, timeout_seconds: String(value.timeoutSeconds) })) data[key] = encode(raw);
    const desired: V1Secret = { metadata: { name: secretRef, namespace: this.namespace, labels: { 'app.kubernetes.io/managed-by': 'schemaops', 'schemaops.io/target-secret': 'true' } }, type: 'Opaque', data };
    try {
      const current = await this.api.readNamespacedSecret({ name: secretRef, namespace: this.namespace });
      desired.metadata = { ...desired.metadata, resourceVersion: current.metadata?.resourceVersion };
      const saved = await this.api.replaceNamespacedSecret({ name: secretRef, namespace: this.namespace, body: desired });
      return { version: saved.metadata?.resourceVersion };
    } catch (error) {
      const status = (error as { response?: { statusCode?: number } }).response?.statusCode;
      if (status !== 404) throw new Error('KUBERNETES_SECRET_WRITE_FAILED');
      const saved = await this.api.createNamespacedSecret({ namespace: this.namespace, body: desired });
      return { version: saved.metadata?.resourceVersion };
    }
  }

  async read(secretRef: string, _tenantId?: string): Promise<ConnectionSecret | undefined> {
    validateSecretName(secretRef);
    try {
      const secret = await this.api.readNamespacedSecret({ name: secretRef, namespace: this.namespace });
      const data = secret.data ?? {};
      const engine = decode(data.engine) as DatabaseEngine;
      if (!engine || !decode(data.host) || !decode(data.database) || !decode(data.username) || !decode(data.password)) return undefined;
      return { engine, host: decode(data.host), port: Number(decode(data.port) || 0), database: decode(data.database), schema: decode(data.schema), username: decode(data.username), password: decode(data.password), sslMode: (decode(data.ssl_mode) || 'require') as SslMode, timeoutSeconds: Number(decode(data.timeout_seconds) || 30) };
    } catch (error) {
      const status = (error as { response?: { statusCode?: number } }).response?.statusCode;
      if (status === 404) return undefined;
      throw new Error('KUBERNETES_SECRET_READ_FAILED');
    }
  }

  async readGitCredentials(secretRef: string): Promise<GitCredentials | undefined> {
    validateSecretName(secretRef);
    try {
      const secret = await this.api.readNamespacedSecret({ name: secretRef, namespace: this.namespace });
      const data = secret.data ?? {};
      const token = decode(data.token ?? data.password);
      if (!token) return undefined;
      return { username: decode(data.username) || 'x-access-token', token };
    } catch (error) {
      const status = (error as { response?: { statusCode?: number } }).response?.statusCode;
      if (status === 404) return undefined;
      throw new Error('KUBERNETES_GIT_SECRET_READ_FAILED');
    }
  }

  async resolve(secretRef: string, _targetId: string): Promise<AdapterConnection | undefined> {
    const value = await this.read(secretRef);
    return value ? { host: value.host, port: value.port, database: value.database, user: value.username, password: value.password, schema: value.schema, ssl: value.sslMode !== 'disable' } : undefined;
  }
}

function encryptionKey(): Buffer {
  const encoded = process.env.SCHEMAOPS_MASTER_KEY;
  if (!encoded) throw new Error('SECRET_ENCRYPTION_KEY_NOT_CONFIGURED');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('SECRET_ENCRYPTION_KEY_INVALID');
  return key;
}
function encodePayload(payload: ManagedSecretPayload): { ciphertext: string; nonce: string; authTag: string } {
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce); const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), nonce: nonce.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}
function decodePayload(row: { ciphertext: string; nonce: string; authTag: string }): ManagedSecretPayload {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(row.nonce, 'base64')); decipher.setAuthTag(Buffer.from(row.authTag, 'base64')); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8')) as ManagedSecretPayload;
}
function validateManagedRef(secretRef: string): void { if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(secretRef) || secretRef.length > 253) throw new Error('INVALID_SECRET_REF'); }

export class DatabaseSecretStore implements ConnectionSecretStore, ManagedSecretStore, SecretResolver {
  constructor(private readonly pool: Pool) {}
  async write(secretRef: string, value: ConnectionSecret, tenantId?: string): Promise<SecretVersion> { const metadata = await this.writeManaged(secretRef, 'DATABASE_CONNECTION', value, 'system', undefined, tenantId); return { version: `v${metadata.version}` }; }
  async read(secretRef: string, tenantId?: string): Promise<ConnectionSecret | undefined> { const result = await this.pool.query(`SELECT secret_type AS "kind",ciphertext,nonce,auth_tag AS "authTag" FROM schemaops.secret_records WHERE secret_ref=$1 AND ($2::uuid IS NULL OR tenant_id=$2)`, [secretRef, tenantId??null]); if (!result.rows[0] || result.rows[0].kind !== 'DATABASE_CONNECTION') return undefined; return decodePayload(result.rows[0]) as ConnectionSecret; }
  async resolve(secretRef: string, targetId: string): Promise<AdapterConnection | undefined> { const scope=await this.pool.query(`SELECT p.tenant_id AS "tenantId" FROM schemaops.targets t JOIN schemaops.projects p ON p.id=t.project_id WHERE t.id=$1`,[targetId]); const value = await this.read(secretRef, scope.rows[0]?.tenantId as string|undefined); return value ? { host:value.host, port:value.port, database:value.database, user:value.username, password:value.password, schema:value.schema, ssl:value.sslMode !== 'disable' } : undefined; }
  async readGitCredentials(secretRef: string, tenantId?: string): Promise<GitCredentials | undefined> { const result = await this.pool.query(`SELECT secret_type AS "kind",ciphertext,nonce,auth_tag AS "authTag" FROM schemaops.secret_records WHERE secret_ref=$1 AND ($2::uuid IS NULL OR tenant_id=$2)`, [secretRef, tenantId??null]); if (!result.rows[0] || result.rows[0].kind !== 'GIT_CREDENTIAL') return undefined; return decodePayload(result.rows[0]) as GitCredentials; }
  async writeManaged(secretRef: string, kind: ManagedSecretKind, payload: ManagedSecretPayload, actorId: string, description?: string, tenantId?: string): Promise<ManagedSecretMetadata> { validateManagedRef(secretRef); const encrypted=encodePayload(payload); const result=await this.pool.query(`INSERT INTO schemaops.secret_records (tenant_id,secret_ref,secret_type,ciphertext,nonce,auth_tag,description,version,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$8) ON CONFLICT (secret_ref) DO UPDATE SET tenant_id=COALESCE(EXCLUDED.tenant_id,schemaops.secret_records.tenant_id),secret_type=EXCLUDED.secret_type,ciphertext=EXCLUDED.ciphertext,nonce=EXCLUDED.nonce,auth_tag=EXCLUDED.auth_tag,description=EXCLUDED.description,version=schemaops.secret_records.version+1,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING tenant_id AS "tenantId",secret_ref AS "secretRef",secret_type AS kind,version,created_at AS "createdAt",updated_at AS "updatedAt",created_by AS "createdBy",updated_by AS "updatedBy",description`, [tenantId??null,secretRef,kind,encrypted.ciphertext,encrypted.nonce,encrypted.authTag,description??null,actorId]); return result.rows[0] as ManagedSecretMetadata; }
  async listManaged(tenantId?: string): Promise<ManagedSecretMetadata[]> { const result=await this.pool.query(`SELECT tenant_id AS "tenantId",secret_ref AS "secretRef",secret_type AS kind,version,created_at AS "createdAt",updated_at AS "updatedAt",created_by AS "createdBy",updated_by AS "updatedBy",description FROM schemaops.secret_records WHERE ($1::uuid IS NULL OR tenant_id=$1) ORDER BY updated_at DESC`, [tenantId??null]); return result.rows as ManagedSecretMetadata[]; }
  async deleteManaged(secretRef: string): Promise<boolean> { const result=await this.pool.query(`DELETE FROM schemaops.secret_records WHERE secret_ref=$1`, [secretRef]); return result.rowCount === 1; }
}

export class UnsupportedConnectionSecretStore implements ConnectionSecretStore {
  async write(_secretRef: string, _value: ConnectionSecret): Promise<SecretVersion> { throw new Error('SECRET_BACKEND_NOT_CONFIGURED'); }
  async read(_secretRef: string): Promise<ConnectionSecret | undefined> { throw new Error('SECRET_BACKEND_NOT_CONFIGURED'); }
}

export async function testConnection(engine: DatabaseEngine, connection: AdapterConnection, factory = createDatabaseAdapter): Promise<{ durationMs: number }> {
  const started = Date.now();
  let adapter: DatabaseAdapter | undefined;
  try { adapter = await factory(engine, connection); return { durationMs: Date.now() - started }; }
  finally { await adapter?.close(); }
}

export function connectionSecretFor(engine: DatabaseEngine, input: { host: string; port: number; databaseName: string; schemaName: string; username: string; password: string; sslMode: SslMode; timeoutSeconds: number }): ConnectionSecret {
  return { engine, host: input.host, port: input.port, database: input.databaseName, schema: input.schemaName, username: input.username, password: input.password, sslMode: input.sslMode, timeoutSeconds: input.timeoutSeconds };
}

export function backendSupportsCredentialWrite(backend: SecretBackend): boolean { return backend === 'database' || backend === 'kubernetes'; }
