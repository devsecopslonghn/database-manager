import { fingerprint, type InventoryItem, type MigrationPlan } from './domain.js';
import type { Store } from './store.js';

export function pendingInventory(inventory: InventoryItem[], fromVersion?: string, toVersion?: string): InventoryItem[] {
  return inventory.filter((item) => {
    if (item.kind === 'UNDO') return false;
    if (!['PENDING', 'CHANGED', 'FAILED'].includes(item.status)) return false;
    if (fromVersion && item.version && item.version.localeCompare(fromVersion, undefined, { numeric: true }) <= 0) return false;
    if (toVersion && item.version && item.version.localeCompare(toVersion, undefined, { numeric: true }) > 0) return false;
    return true;
  });
}

export async function buildPlan(store: Store, targetId: string, createdBy: string, options: { fromVersion?: string; toVersion?: string; autoApprove?: boolean }): Promise<MigrationPlan> {
  const inventory = await store.listInventory(targetId);
  const selected = pendingInventory(inventory, options.fromVersion, options.toVersion);
  const items = selected.map((item, index) => ({ sourceType: 'GIT' as const, migrationFileId: item.migrationFileId, path: item.path, kind: item.kind, version: item.version, checksum: item.checksum, executionSequence: index + 1, outOfOrder: Boolean(item.outOfOrder), status: 'PENDING' as const }));
  const snapshotId = selected.find((item) => item.sourceSnapshotId)?.sourceSnapshotId;
  return store.createPlan({ targetId, snapshotId, fromVersion: options.fromVersion, toVersion: options.toVersion, status: options.autoApprove ? 'APPROVED' : 'APPROVAL_REQUIRED', fingerprint: fingerprint(items.map((item) => `${item.executionSequence}:${item.path}:${item.checksum}`)), autoApprove: options.autoApprove ?? false, createdBy, items });
}
