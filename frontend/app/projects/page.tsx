'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import LoadingState from '../components/LoadingState';
import { api, type Project } from '../../lib/api';

type ProjectForm = {
  tenantId: string;
  name: string;
  databaseEngine: string;
  repositoryUrl: string;
  defaultRef: string;
  migrationPath: string;
};

const emptyForm: ProjectForm = {
  tenantId: '',
  name: '',
  databaseEngine: 'postgresql',
  repositoryUrl: '',
  defaultRef: 'master',
  migrationPath: 'migrations',
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>();
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<ProjectForm>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ items: Project[] }>('/projects')
      .then((response) => setProjects(response.items))
      .catch((error) => setMessage(error instanceof Error ? error.message : 'PROJECTS_FAILED'));
  }, []);

  function change(name: keyof ProjectForm, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const project = await api<Project>('/projects', { method: 'POST', body: JSON.stringify(form) });
      setProjects((current) => [project, ...(current ?? [])]);
      setForm(emptyForm);
      setShowForm(false);
      setMessage(`Project “${project.name}” created. Open it to sync the repository.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'PROJECT_CREATE_FAILED');
    } finally {
      setBusy(false);
    }
  }

  return <AppShell breadcrumb="Tenant / Projects">
    <div className="page-heading">
      <div><p className="eyebrow">PROJECTS</p><h1>Migration repositories</h1><p className="muted">Each project fixes one target database engine and can map to multiple environments.</p></div>
      <button className="button primary" type="button" onClick={() => { setMessage(''); setShowForm(true); }}>New project</button>
    </div>
    {message ? <div className="alert info-box" role="status">{message}</div> : null}
    {showForm ? <ProjectOnboarding form={form} busy={busy} change={change} close={() => setShowForm(false)} submit={createProject} /> : null}
    {!projects && !message ? <LoadingState /> : null}
    <section className="panel">
      {projects?.length ? <table><thead><tr><th>Project</th><th>Engine</th><th>Repository</th><th>Default ref</th><th>Migration path</th></tr></thead><tbody>{projects.map((project) => <tr key={project.id}><td><Link className="text-link" href={`/projects/${project.id}`}>{project.name}</Link><br /><span className="small muted">{project.id}</span></td><td><span className="code">{project.databaseEngine}</span></td><td className="truncate">{project.repositoryUrl}</td><td className="code">{project.defaultRef}</td><td className="code">{project.migrationPath}</td></tr>)}</tbody></table> : <div className="empty-state"><h2>No projects yet</h2><p className="muted">Start the onboarding flow to register a repository and database engine.</p><button className="button primary" type="button" onClick={() => setShowForm(true)}>Create your first project</button></div>}
    </section>
  </AppShell>;
}

function ProjectOnboarding({ form, busy, change, close, submit }: { form: ProjectForm; busy: boolean; change: (name: keyof ProjectForm, value: string) => void; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  return <section className="panel onboarding-panel">
    <div className="section-heading"><div><p className="eyebrow">PROJECT ONBOARDING · STEP 1</p><h2>Register a migration repository</h2><p className="muted">The project engine is fixed at creation and is never translated between database vendors.</p></div><button className="icon-button" type="button" onClick={close} aria-label="Close onboarding">×</button></div>
    <form className="form" onSubmit={submit}>
      <div className="form-grid">
        <label>Tenant UUID<input required value={form.tenantId} placeholder="00000000-0000-0000-0000-000000000000" onChange={(event) => change('tenantId', event.target.value)} /><span className="small muted">Use an existing tenant UUID; projects cannot be created outside a tenant.</span></label>
        <label>Project name<input required maxLength={120} value={form.name} placeholder="database-demo" onChange={(event) => change('name', event.target.value)} /></label>
        <label>Database engine<select value={form.databaseEngine} onChange={(event) => change('databaseEngine', event.target.value)}><option value="postgresql">PostgreSQL</option><option value="mysql">MySQL</option><option value="oracle">Oracle</option><option value="sqlserver">SQL Server</option></select></label>
        <label>Repository URL<input required type="url" value={form.repositoryUrl} placeholder="https://github.com/org/repository.git" onChange={(event) => change('repositoryUrl', event.target.value)} /><span className="small muted">Repository credentials are not accepted in the URL.</span></label>
        <label>Default Git ref<input required value={form.defaultRef} placeholder="master" onChange={(event) => change('defaultRef', event.target.value)} /></label>
        <label>Migration path<input required value={form.migrationPath} placeholder="migrations" onChange={(event) => change('migrationPath', event.target.value)} /></label>
      </div>
      <div className="button-row"><button className="button secondary" type="button" onClick={close}>Cancel</button><button className="button primary" disabled={busy} type="submit">{busy ? 'Creating…' : 'Create project'}</button></div>
    </form>
  </section>;
}
