import { getAccessToken, login } from './oidc';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  if (!token) { await login(window.location.pathname); throw new Error('AUTH_REQUIRED'); }
  const response = await fetch(`/api/v1${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}), authorization: `Bearer ${token}` }, cache: 'no-store' });
  const body = await response.json().catch(() => ({})) as T & { code?: string; message?: string };
  if (!response.ok) throw new Error(body.code ?? body.message ?? `REQUEST_FAILED_${response.status}`);
  return body;
}

export type Dashboard = { metrics: { projects: number; targets: number; pendingMigrations: number; failedRuns: number }; projects: Project[]; targets: Target[]; operations: Operation[]; audit: AuditEvent[] };
export type Tenant = { id: string; name: string; slug: string; createdAt: string };
export type Project = { id: string; tenantId: string; name: string; databaseEngine: string; repositoryUrl: string; defaultRef: string; migrationPath: string; createdAt: string };
export type Environment = { id: string; projectId: string; name: string; createdAt: string };
export type Target = { id: string; projectId: string; environmentId: string; name: string; gitRef: string; databaseName: string; schemaName: string; secretRef: string; createdAt: string };
export type TargetConnection = { targetId: string; engine: string; host: string; port: number; databaseName: string; schemaName: string; username: string; secretBackend: string; secretRef: string; sslMode: string; timeoutSeconds: number; credentialVersion?: string; lastTestStatus?: string; lastTestAt?: string; lastTestDurationMs?: number; lastTestError?: string; updatedAt?: string; updatedBy?: string };
export type InventoryItem = { path: string; kind: string; version?: string; description: string; checksum: string; status: string; appliedAt?: string; executionSequence?: number; outOfOrder?: boolean };
export type Plan = { id: string; targetId: string; fromVersion?: string; toVersion?: string; status: string; fingerprint: string; autoApprove: boolean; createdBy: string; createdAt: string; items: Array<{ id: string; path: string; kind: string; version?: string; checksum: string; executionSequence: number; outOfOrder: boolean; status: string }> };
export type Operation = { id: string; targetId: string; planId?: string; sourceOperationId?: string; type: string; status: string; actorId: string; correlationId: string; createdAt: string };
export type BackupPlan = { id: string; targetId: string; scriptRef: string; requiredBeforeExecute: boolean; retentionDays: number; createdAt: string };
export type BackupArtifact = { id: string; targetId: string; artifactRef?: string; checksum?: string; status: string; scopeFromVersion?: string; scopeToVersion?: string; createdAt: string; expiresAt?: string };
export type Preflight = { planId: string; passed: boolean; checks: Array<{ name: string; status: string; detail?: string }> };
export type AuditEvent = { id: string; actorId: string; action: string; resourceType: string; resourceId: string; metadata: Record<string, unknown>; createdAt: string };
