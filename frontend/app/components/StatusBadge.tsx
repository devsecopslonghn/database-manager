export default function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const tone = normalized.includes('fail') || normalized.includes('reject') || normalized.includes('drift') ? 'danger' : normalized.includes('pending') || normalized.includes('approval') || normalized.includes('queue') || normalized.includes('run') ? 'warning' : normalized.includes('applied') || normalized.includes('success') || normalized.includes('healthy') || normalized.includes('approve') ? 'success' : 'neutral';
  return <span className={`status-badge ${tone}`}><span className="status-dot" />{status.replaceAll('_', ' ')}</span>;
}
