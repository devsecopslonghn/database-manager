import Link from 'next/link';

const stats = [
  ['Targets', '0', 'No targets configured'],
  ['Pending migrations', '0', 'Sync a repository to discover changes'],
  ['Manual operations', '0', 'No manual SQL submitted'],
  ['Failed runs', '0', 'Control-plane is healthy'],
];

export default function DashboardPage() {
  return (
    <main className="shell">
      <header className="topbar">
        <div><p className="eyebrow">DATABASE MIGRATION CONTROL PLANE</p><h1>SchemaOps</h1></div>
        <span className="status-pill success">Control plane ready</span>
      </header>
      <section className="hero">
        <div><p className="eyebrow">OPERATIONS OVERVIEW</p><h2>Make database changes visible and controlled.</h2><p className="muted">Git-managed and manual migrations will use the same plan, approval, backup and audit lifecycle.</p></div>
        <Link className="button primary" href="/manual-migration">Open manual migration</Link>
      </section>
      <section className="stats" aria-label="Migration statistics">
        {stats.map(([label, value, detail]) => <article className="card" key={label}><p className="muted">{label}</p><strong>{value}</strong><p className="small muted">{detail}</p></article>)}
      </section>
      <section className="card activity"><div className="section-heading"><div><p className="eyebrow">NEXT STEP</p><h3>Configure the first target</h3></div><span className="status-pill neutral">MVP foundation</span></div><p className="muted">Create a project, map an environment to a target database, then sync its migration source.</p></section>
    </main>
  );
}
