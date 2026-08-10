'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppShell from '../../../components/AppShell';
import LoadingState from '../../../components/LoadingState';
import StatusBadge from '../../../components/StatusBadge';
import { api, type Operation } from '../../../../lib/api';

export default function OperationsPage() {
  const { targetId } = useParams<{ targetId: string }>(); const [operations, setOperations] = useState<Operation[]>(); const [message, setMessage] = useState('');
  async function load() { const response = await api<{ items: Operation[] }>(`/targets/${targetId}/operations`); setOperations(response.items); }
  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : 'OPERATIONS_FAILED')); }, [targetId]);
  return <AppShell breadcrumb={`Tenant / Target / ${targetId} / Operations`}><div className="page-heading"><div><p className="eyebrow">EXECUTION HISTORY</p><h1>Operations</h1><p className="muted">Every sync, backup, migration and rollback operation has a durable status and correlation ID.</p></div><button className="button secondary" type="button" onClick={() => load().catch((error) => setMessage(error instanceof Error ? error.message : 'OPERATIONS_FAILED'))}>Refresh</button></div>{message ? <div className="alert danger-box">{message}</div> : null}{!operations && !message ? <LoadingState /> : null}<section className="panel table-panel">{operations?.length ? <table><thead><tr><th>Operation</th><th>Type</th><th>Status</th><th>Actor</th><th>Correlation</th><th>Created</th><th /></tr></thead><tbody>{operations.map((operation) => <tr key={operation.id}><td className="code">{operation.id.slice(0, 8)}…</td><td>{operation.type}</td><td><StatusBadge status={operation.status} /></td><td className="code">{operation.actorId}</td><td className="code">{operation.correlationId}</td><td className="small">{new Date(operation.createdAt).toLocaleString()}</td><td><Link className="text-link" href={`/operations/${operation.id}`}>Details →</Link></td></tr>)}</tbody></table> : operations ? <div className="empty-state"><h2>No operations yet</h2><p className="muted">Operations will appear after backup, execution or rollback is requested.</p></div> : null}</section></AppShell>;
}
