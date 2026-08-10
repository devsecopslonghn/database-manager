'use client';

import { useState, type FormEvent } from 'react';
import { getAccessToken, login } from '../../lib/oidc';

export default function ManualMigrationPage() {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    const data = new FormData(event.currentTarget);
    const targetId = String(data.get('targetId') ?? '');
    const sequence = String(data.get('executionSequence') ?? '');
    const payload = {
      sqlPayload: String(data.get('sqlPayload') ?? ''),
      versionContext: String(data.get('versionContext') ?? '') || undefined,
      executionSequence: sequence ? Number(sequence) : undefined,
      reason: String(data.get('reason') ?? ''),
      outOfOrder: Boolean(sequence),
    };
    try {
      const token = getAccessToken();
      if (!token) {
        await login('/manual-migration');
        return;
      }
      const response = await fetch(`/api/v1/targets/${targetId}/manual-migrations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as { id?: string; code?: string };
      if (!response.ok) throw new Error(body.code ?? 'MANUAL_MIGRATION_FAILED');
      setMessage(`Manual migration ${body.id} was stored as a draft. No target SQL was executed.`);
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'MANUAL_MIGRATION_FAILED');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell narrow">
      <header className="topbar"><div><p className="eyebrow">MANUAL_UI</p><h1>Manual migration</h1></div><span className="status-pill warning">High impact</span></header>
      <form className="card form" onSubmit={submit}>
        <label>Target ID<input name="targetId" required placeholder="UUID of the configured target" /></label>
        <label>SQL payload<textarea name="sqlPayload" required minLength={1} maxLength={1000000} placeholder="CREATE TABLE ..." rows={14} /></label>
        <div className="form-grid"><label>Version context<input name="versionContext" placeholder="V7" /></label><label>Execution sequence<input name="executionSequence" type="number" min={1} placeholder="Optional" /></label></div>
        <label>Reason<input name="reason" required placeholder="Why is this migration outside Git?" /></label>
        <div className="warning-box">This SQL will be stored in the SchemaOps control plane and will not be written to Git.</div>
        <button className="button primary" disabled={submitting} type="submit">{submitting ? 'Preparing…' : 'Validate and create plan'}</button>
        {message ? <p className="small muted" role="status">{message}</p> : null}
      </form>
    </main>
  );
}
