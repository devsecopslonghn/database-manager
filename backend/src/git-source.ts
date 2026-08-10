import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { fingerprint } from './domain.js';
import { parseMigrationFiles } from './migration-parser.js';
import type { ManagedSecretStore } from './secret-store.js';
import type { Store } from './store.js';

const execFileAsync = promisify(execFile);

async function collectSqlFiles(root: string, directory: string, output: Array<{ path: string; sqlPayload: string }>): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) await collectSqlFiles(root, fullPath, output);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sql')) output.push({ path: relative(root, fullPath).replaceAll('\\', '/'), sqlPayload: await readFile(fullPath, 'utf8') });
  }
}

export async function syncProjectSource(store: Store, projectId: string, gitRef: string | undefined, actorId: string, secretManager?: Pick<ManagedSecretStore, 'readGitCredentials'>) {
  const projects = await store.listProjects();
  const project = projects.find((item) => item.id === projectId);
  if (!project) throw new Error('PROJECT_NOT_FOUND');
  const ref = gitRef ?? project.defaultRef;
  const url = new URL(project.repositoryUrl);
  if (url.username || url.password) throw new Error('REPOSITORY_CREDENTIALS_MUST_USE_WORKLOAD_IDENTITY');
  const workspace = await mkdtemp(join(tmpdir(), 'schemaops-git-'));
  let askpass: string | undefined;
  try {
    const environment = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    if (project.gitSecretRef) {
      const credentials = await secretManager?.readGitCredentials(project.gitSecretRef, project.tenantId);
      if (!credentials) throw new Error('GIT_CREDENTIAL_SECRET_NOT_FOUND_OR_INVALID');
      askpass = join(workspace, '.git-askpass');
      await writeFile(askpass, '#!/bin/sh\ncase "$1" in *Username*) printf \'%s\' "$GIT_USERNAME" ;; *) printf \'%s\' "$GIT_TOKEN" ;; esac\n', { mode: 0o700 });
      await chmod(askpass, 0o700);
      Object.assign(environment, { GIT_ASKPASS: askpass, GIT_USERNAME: credentials.username, GIT_TOKEN: credentials.token });
    }
    await execFileAsync('git', ['clone', '--depth', '1', '--branch', ref, '--no-tags', project.repositoryUrl, workspace], { timeout: 120_000, maxBuffer: 1_000_000, env: environment });
    const revision = await execFileAsync('git', ['-C', workspace, 'rev-parse', 'HEAD'], { timeout: 10_000, maxBuffer: 100_000 });
    const commitSha = revision.stdout.trim();
    const sourceRoot = join(workspace, project.migrationPath);
    const files: Array<{ path: string; sqlPayload: string }> = [];
    await collectSqlFiles(sourceRoot, sourceRoot, files);
    const parsed = parseMigrationFiles(files);
    const existing = await store.getSnapshotByCommit(projectId, ref, commitSha);
    if (existing?.status === 'SUCCEEDED') return existing;
    return store.createSnapshot({
      projectId,
      gitRef: ref,
      commitSha,
      sourceFingerprint: fingerprint(parsed.map((file) => `${file.path}:${file.checksum}`)),
      status: 'SUCCEEDED',
      createdBy: actorId,
      files: parsed,
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'GIT_SYNC_FAILED';
    const message = /could not read Username|authentication failed|repository not found/i.test(rawMessage) ? 'GIT_CREDENTIALS_REQUIRED' : rawMessage.split('\n')[0].slice(0, 500);
    return store.createSnapshot({ projectId, gitRef: ref, commitSha: 'unknown', sourceFingerprint: 'unknown', status: 'FAILED', errorMessage: message, createdBy: actorId, files: [] });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
