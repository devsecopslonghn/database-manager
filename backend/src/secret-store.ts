import { CoreV1Api, KubeConfig, type V1Secret } from '@kubernetes/client-node';
import { createDatabaseAdapter, type DatabaseAdapter, type SecretResolver, type TargetConnection as AdapterConnection } from './database-adapters.js';
import type { DatabaseEngine, SecretBackend, SslMode } from './domain.js';

export type ConnectionSecret = { engine: DatabaseEngine; host: string; port: number; database: string; schema: string; username: string; password: string; sslMode: SslMode; timeoutSeconds: number };
export type SecretVersion = { version?: string };

export interface ConnectionSecretStore {
  write(secretRef: string, value: ConnectionSecret): Promise<SecretVersion>;
  read(secretRef: string): Promise<ConnectionSecret | undefined>;
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

  async write(secretRef: string, value: ConnectionSecret): Promise<SecretVersion> {
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

  async read(secretRef: string): Promise<ConnectionSecret | undefined> {
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

  async resolve(secretRef: string, _targetId: string): Promise<AdapterConnection | undefined> {
    const value = await this.read(secretRef);
    return value ? { host: value.host, port: value.port, database: value.database, user: value.username, password: value.password, schema: value.schema, ssl: value.sslMode !== 'disable' } : undefined;
  }
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

export function backendSupportsCredentialWrite(backend: SecretBackend): boolean { return backend === 'kubernetes'; }
