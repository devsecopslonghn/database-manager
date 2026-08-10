'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AppShell from './components/AppShell';
import LoadingState from './components/LoadingState';
import StatusBadge from './components/StatusBadge';
import { api, type Dashboard } from '../lib/api';

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard>(); const [error, setError] = useState('');
  useEffect(() => { api<Dashboard>('/dashboard').then(setData).catch((e) => setError(e instanceof Error ? e.message : 'DASHBOARD_FAILED')); }, []);
  return <AppShell><div className="page-heading"><div><p className="eyebrow">OPERATIONS OVERVIEW</p><h1>Migration command center</h1><p className="muted">A single view of target health, migration state, approvals and audit evidence.</p></div><Link className="button primary" href="/projects">Configure project</Link></div>
    {error ? <div className="alert danger-box">Unable to load dashboard: {error}</div> : null}{!data && !error ? <LoadingState /> : null}
    {data ? <><section className="metric-grid">{[['Projects',data.metrics.projects,'Repositories under management'],['Targets',data.metrics.targets,'Environment/database mappings'],['Pending migrations',data.metrics.pendingMigrations,'Requires plan review'],['Failed runs',data.metrics.failedRuns,'Needs operator attention']].map(([label,value,detail])=><article className="metric-card" key={String(label)}><p className="label-caps">{label}</p><strong>{value}</strong><p className="small muted">{detail}</p></article>)}</section>
      <div className="dashboard-grid"><section className="panel"><div className="section-heading"><div><p className="eyebrow">TARGETS</p><h2>Environment coverage</h2></div><Link className="text-link" href="/projects">View projects →</Link></div>{data.targets.length ? <table><thead><tr><th>Target</th><th>Engine</th><th>Schema</th><th>State</th></tr></thead><tbody>{data.targets.map((target)=><tr key={target.id}><td><Link className="text-link" href={`/targets/${target.id}`}>{target.name}</Link><br /><span className="small muted">{target.databaseName}</span></td><td>Configured</td><td className="code">{target.schemaName}</td><td><StatusBadge status="HEALTHY" /></td></tr>)}</tbody></table> : <div className="empty-state"><p>No targets configured.</p><Link className="text-link" href="/projects">Create the first project and target →</Link></div>}</section>
      <section className="panel"><div className="section-heading"><div><p className="eyebrow">RECENT ACTIVITY</p><h2>Audit evidence</h2></div><Link className="text-link" href="/audit">Open audit →</Link></div>{data.audit.length ? <div className="activity-list">{data.audit.map((event)=><div className="activity-row" key={event.id}><StatusBadge status="RECORDED" /><div><strong>{event.action}</strong><p className="small muted">{event.actorId} · {new Date(event.createdAt).toLocaleString()}</p></div></div>)}</div> : <div className="empty-state"><p>No audit events yet.</p><span className="small muted">Every plan, approval and operation will appear here.</span></div>}</section></div></> : null}
  </AppShell>;
}
