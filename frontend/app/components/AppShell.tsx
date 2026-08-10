'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AuthButton from './AuthButton';

const links = [['/', 'Dashboard'], ['/projects', 'Projects'], ['/audit', 'Audit log'], ['/admin/access', 'RBAC administration'], ['/manual-migration', 'Manual SQL']];

export default function AppShell({ children, breadcrumb = 'Tenant / Control plane' }: { children: React.ReactNode; breadcrumb?: string }) {
  const pathname = usePathname();
  return <div className="app-frame">
    <aside className="sidebar"><div className="brand-mark">S</div><div className="brand-copy"><strong>SchemaOps</strong><span>CONTROL PLANE</span></div>
      <nav className="nav-list" aria-label="Primary navigation">{links.map(([href, label]) => <Link className={pathname === href || (href !== '/' && pathname.startsWith(href)) ? 'nav-link active' : 'nav-link'} href={href} key={href}><span className="nav-icon">{label.slice(0, 1)}</span>{label}</Link>)}</nav>
      <div className="sidebar-footer"><span className="status-dot success-dot" /> Control plane ready<br /><span className="small muted">v0.1 · audit protected</span></div>
    </aside>
    <div className="workspace"><header className="app-header"><div><p className="breadcrumb">{breadcrumb}</p><p className="eyebrow">DATABASE MIGRATION CONTROL PLANE</p></div><AuthButton /></header><main className="content">{children}</main></div>
  </div>;
}
