'use client';

import { useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import LoadingState from '../components/LoadingState';
import { api, type AuditEvent, type SecretMetadata, type Tenant } from '../../lib/api';
import './secrets.css';

type SecretKind = SecretMetadata['kind'];

type SecretForm = {
  secretRef: string;
  kind: SecretKind;
  username: string;
  token: string;
  engine: string;
  host: string;
  port: string;
  databaseName: string;
  schemaName: string;
  description: string;
};

const emptyForm = (): SecretForm => ({
  secretRef: '',
  kind: 'DATABASE_CONNECTION',
  username: '',
  token: '',
  engine: 'postgresql',
  host: '',
  port: '5432',
  databaseName: '',
  schemaName: 'public',
  description: '',
});

function kindLabel(kind: SecretKind) {
  return kind === 'DATABASE_CONNECTION' ? 'DB Connection' : 'Git Credential';
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function SecretModal({
  initial,
  busy,
  mode,
  onClose,
  onSave,
}: {
  initial: SecretForm;
  busy: boolean;
  mode: 'create' | 'rotate';
  onClose: () => void;
  onSave: (form: SecretForm) => Promise<void>;
}) {
  const [form, setForm] = useState(initial);
  const change = (key: keyof SecretForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const database = form.kind === 'DATABASE_CONNECTION';

  return <div className="modal-backdrop" role="presentation">
    <form className="modal-card secret-modal" onSubmit={async (event) => { event.preventDefault(); await onSave(form); }}>
      <div className="modal-header">
        <div><h2>{mode === 'create' ? 'Create Secret' : 'Rotate Secret'}</h2><p className="muted">{mode === 'create' ? 'Configure credentials for secure access.' : 'Enter replacement credentials. The previous version remains inaccessible.'}</p></div>
        <button aria-label="Close modal" className="icon-button" type="button" onClick={onClose}>×</button>
      </div>
      <div className="secret-tabs" role="tablist" aria-label="Secret type">
        <button className={database ? 'secret-tab active' : 'secret-tab'} type="button" role="tab" aria-selected={database} onClick={() => change('kind', 'DATABASE_CONNECTION')}>Database Connection</button>
        <button className={!database ? 'secret-tab active' : 'secret-tab'} type="button" role="tab" aria-selected={!database} onClick={() => change('kind', 'GIT_CREDENTIAL')}>Git Credential</button>
      </div>
      <div className="modal-body">
        <div className="security-note"><strong>Encrypted at rest.</strong> Secret values cannot be revealed after saving.</div>
        <div className="form-grid">
          <label>Secret reference<input required pattern="[a-z0-9]([-a-z0-9]*[a-z0-9])?" value={form.secretRef} disabled={mode === 'rotate'} placeholder="database-demo-connection" onChange={(event) => change('secretRef', event.target.value)} /><span className="field-help">Use this reference in project and target settings.</span></label>
          <label>Description<input value={form.description} placeholder="Production database credentials" onChange={(event) => change('description', event.target.value)} /></label>
        </div>
        {database ? <>
          <div className="form-grid">
            <label>Engine<select value={form.engine} onChange={(event) => change('engine', event.target.value)}><option value="postgresql">PostgreSQL</option><option value="mysql">MySQL</option><option value="oracle">Oracle</option><option value="sqlserver">SQL Server</option></select></label>
            <label>Host<input required value={form.host} placeholder="db.example.internal" onChange={(event) => change('host', event.target.value)} /></label>
            <label>Port<input required type="number" min="1" max="65535" value={form.port} onChange={(event) => change('port', event.target.value)} /></label>
            <label>Database name<input required value={form.databaseName} placeholder="production_main" onChange={(event) => change('databaseName', event.target.value)} /></label>
          </div>
          <div className="form-grid">
            <label>Schema<input required value={form.schemaName} placeholder="public" onChange={(event) => change('schemaName', event.target.value)} /></label>
            <label>Username<input required value={form.username} placeholder="schemaops_user" onChange={(event) => change('username', event.target.value)} /></label>
            <label>Password<input required type="password" autoComplete="new-password" value={form.token} placeholder="Enter secret value" onChange={(event) => change('token', event.target.value)} /></label>
          </div>
        </> : <div className="form-grid">
          <label>Username<input required value={form.username} placeholder="x-access-token" onChange={(event) => change('username', event.target.value)} /></label>
          <label>Access token<input required type="password" autoComplete="new-password" value={form.token} placeholder="Enter secret value" onChange={(event) => change('token', event.target.value)} /></label>
        </div>}
      </div>
      <div className="modal-footer"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy} type="submit">{busy ? 'Encrypting…' : mode === 'create' ? 'Save Secret' : 'Rotate Secret'}</button></div>
    </form>
  </div>;

}

export default function SecretsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [secrets, setSecrets] = useState<SecretMetadata[]>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<{ mode: 'create' | 'rotate'; secret?: SecretMetadata }>();
  const [audit, setAudit] = useState<{ secret: SecretMetadata; events: AuditEvent[] }>();

  async function load(id = tenantId) {
    if (!id) return;
    const response = await api<{ items: SecretMetadata[] }>(`/secrets?tenantId=${id}`);
    setSecrets(response.items);
  }

  useEffect(() => {
    api<{ items: Tenant[] }>('/tenants').then((response) => {
      setTenants(response.items);
      setTenantId(response.items[0]?.id ?? '');
    }).catch((error) => setMessage(error instanceof Error ? error.message : 'TENANTS_FAILED'));
  }, []);

  useEffect(() => {
    if (tenantId) load().catch((error) => setMessage(error instanceof Error ? error.message : 'SECRETS_FAILED'));
  }, [tenantId]);

  const formFor = (secret?: SecretMetadata): SecretForm => ({ ...emptyForm(), secretRef: secret?.secretRef ?? '', kind: secret?.kind ?? 'DATABASE_CONNECTION', description: secret?.description ?? '' });

  async function save(form: SecretForm) {
    setBusy(true);
    try {
      const payload = form.kind === 'GIT_CREDENTIAL'
        ? { tenantId, secretRef: form.secretRef, kind: form.kind, username: form.username, token: form.token, description: form.description }
        : { tenantId, secretRef: form.secretRef, kind: form.kind, engine: form.engine, host: form.host, port: Number(form.port), databaseName: form.databaseName, schemaName: form.schemaName, username: form.username, password: form.token, sslMode: 'require', timeoutSeconds: 30, description: form.description };
      const value = await api<SecretMetadata>('/secrets', { method: 'POST', body: JSON.stringify(payload) });
      setSecrets((current) => [value, ...(current ?? []).filter((item) => item.secretRef !== value.secretRef)]);
      setModal(undefined);
      setMessage(`Secret ${value.secretRef} saved as encrypted version ${value.version}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'SECRET_SAVE_FAILED');
    } finally {
      setBusy(false);
    }
  }

  async function remove(value: SecretMetadata) {
    if (!window.confirm(`Delete ${value.secretRef}? Existing targets using it will fail closed.`)) return;
    setBusy(true);
    try {
      await api(`/secrets/${encodeURIComponent(value.secretRef)}?tenantId=${tenantId}`, { method: 'DELETE' });
      setSecrets((current) => current?.filter((item) => item.secretRef !== value.secretRef));
      setMessage(`Secret ${value.secretRef} deleted.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'SECRET_DELETE_FAILED');
    } finally {
      setBusy(false);
    }
  }

  async function openAudit(secret: SecretMetadata) {
    setMessage('');
    try {
      const response = await api<{ items: AuditEvent[] }>('/audit-events');
      setAudit({ secret, events: response.items.filter((event) => event.resourceType === 'secret' && event.resourceId === secret.secretRef) });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'AUDIT_FAILED');
    }
  }

  const countLabel = useMemo(() => `${secrets?.length ?? 0} ${secrets?.length === 1 ? 'secret' : 'secrets'}`, [secrets]);

  return <AppShell breadcrumb="Tenant / Security / Secrets">
    <div className="page-heading secret-page-heading"><div><p className="eyebrow">SECURITY · SECRET VAULT</p><h1>Managed Secrets</h1><p className="muted">Inventory of encrypted database credentials and Git access tokens.</p></div><button className="button primary" disabled={!tenantId} type="button" onClick={() => setModal({ mode: 'create' })}>＋ Create Secret</button></div>
    <div className="secret-toolbar"><label>Tenant<select value={tenantId} onChange={(event) => setTenantId(event.target.value)}>{tenants.map((tenant) => <option value={tenant.id} key={tenant.id}>{tenant.name}</option>)}</select></label><span className="small muted">{countLabel} · values are never returned</span></div>
    {message ? <div className="alert info-box" role="status">{message}</div> : null}
    <div className="security-banner"><span className="security-banner-icon">⌑</span><div><strong>Security Notice</strong><p>Secret values are encrypted at rest and cannot be revealed after saving. Rotate secrets immediately if they are compromised.</p></div></div>
    <section className="panel secret-inventory-panel"><div className="section-heading"><div><p className="label-caps">CONTROL PLANE INVENTORY</p><h2>Managed credentials</h2></div><button className="button secondary" type="button" onClick={() => load().catch((error) => setMessage(error instanceof Error ? error.message : 'SECRETS_FAILED'))}>↻ Refresh</button></div>{!secrets && !message ? <LoadingState /> : secrets?.length ? <div className="secret-table-wrap"><table className="secret-table"><thead><tr><th>Secret reference</th><th>Type</th><th>Version</th><th>Updated by</th><th>Last updated</th><th>Status</th><th>Actions</th></tr></thead><tbody>{secrets.map((value) => <tr key={value.secretRef}><td className="code secret-ref-cell">{value.secretRef}</td><td><span className={`secret-type-badge ${value.kind === 'DATABASE_CONNECTION' ? 'database' : 'git'}`}>{value.kind === 'DATABASE_CONNECTION' ? '▣' : '‹›'} {kindLabel(value.kind)}</span></td><td className="code">v{value.version}</td><td className="code small">{value.updatedBy}</td><td className="code small">{formatDate(value.updatedAt)}</td><td><span className="status-badge success"><span className="status-dot" />Healthy</span></td><td><div className="table-actions"><button className="icon-button compact" title="View audit history" type="button" onClick={() => openAudit(value)}>◷</button><button className="icon-button compact" title="Rotate secret" type="button" onClick={() => setModal({ mode: 'rotate', secret: value })}>⟳</button><button className="icon-button compact danger-icon" title="Delete secret" type="button" disabled={busy} onClick={() => remove(value)}>×</button></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><h2>No managed secrets</h2><p className="muted">Create an encrypted DB connection or Git credential to use in a project target.</p><button className="button primary" type="button" onClick={() => setModal({ mode: 'create' })}>Create first secret</button></div>}</section>
    {modal ? <SecretModal initial={formFor(modal.secret)} busy={busy} mode={modal.mode} onClose={() => setModal(undefined)} onSave={save} /> : null}
    {audit ? <div className="drawer-backdrop" role="presentation" onClick={() => setAudit(undefined)}><aside className="audit-drawer" role="dialog" aria-label="Audit history" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><p className="label-caps">AUDIT EVIDENCE</p><h2>Audit History</h2><p className="code small">{audit.secret.secretRef}</p></div><button className="icon-button" type="button" aria-label="Close audit history" onClick={() => setAudit(undefined)}>×</button></div><div className="audit-timeline">{audit.events.length ? audit.events.map((event) => <article className="audit-event" key={event.id}><div className="audit-marker" /><div className="audit-event-head"><strong>{formatDate(event.createdAt)}</strong><span className="status-badge success">Success</span></div><div className="audit-event-card"><span className="event-tag">{event.action.toUpperCase()}</span><p className="code small">{event.actorId}</p>{event.metadata && Object.keys(event.metadata).length ? <p className="small muted">{Object.entries(event.metadata).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</p> : null}</div></article>) : <div className="empty-state"><h2>No audit events</h2><p className="muted">Secret creation, rotation and deletion events will appear here.</p></div>}</div><div className="drawer-footer"><button className="button secondary" type="button" onClick={() => setAudit(undefined)}>Close</button></div></aside></div> : null}
  </AppShell>;
}
