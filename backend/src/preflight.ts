import type { Store } from './store.js';
import type { MigrationPlan } from './domain.js';

export type PreflightCheck = { name: 'source_snapshot' | 'target_lock' | 'backup_policy' | 'connection_health'; status: 'PASSED' | 'AVAILABLE' | 'CONFIGURED' | 'BLOCKED'; detail?: string };

export async function evaluatePreflight(store: Store, plan: MigrationPlan): Promise<{ passed: boolean; checks: PreflightCheck[] }> {
  const manualOnly = plan.items.length > 0 && plan.items.every((item) => item.sourceType === 'MANUAL_UI');
  const backup = await store.getBackupPlan(plan.targetId);
  const artifacts = await store.listBackupArtifacts(plan.targetId);
  const connection = await store.getTargetConnection(plan.targetId);
  const checks: PreflightCheck[] = [
    { name: 'source_snapshot', status: plan.snapshotId || manualOnly ? 'PASSED' : 'BLOCKED', detail: plan.snapshotId || manualOnly ? undefined : 'PLAN_HAS_NO_SUCCESSFUL_SOURCE_SNAPSHOT' },
    { name: 'target_lock', status: 'AVAILABLE' },
    { name: 'backup_policy', status: !backup ? 'BLOCKED' : backup.requiredBeforeExecute && !artifacts.some((artifact) => artifact.status === 'SUCCEEDED') ? 'BLOCKED' : 'CONFIGURED', detail: !backup ? 'BACKUP_PLAN_REQUIRED' : backup.requiredBeforeExecute && !artifacts.some((artifact) => artifact.status === 'SUCCEEDED') ? 'BACKUP_ARTIFACT_REQUIRED' : undefined },
    { name: 'connection_health', status: connection?.lastTestStatus === 'HEALTHY' ? 'PASSED' : 'BLOCKED', detail: connection?.lastTestStatus ? `CONNECTION_${connection.lastTestStatus}` : 'CONNECTION_TEST_REQUIRED' },
  ];
  return { passed: checks.every((check) => ['PASSED', 'AVAILABLE', 'CONFIGURED'].includes(check.status)), checks };
}
