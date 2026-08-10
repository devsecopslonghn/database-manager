import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { fingerprint } from './domain.js';
import { parseMigrationFiles } from './migration-parser.js';
import type { Store } from './store.js';

const execFileAsync = promisify(execFile);

async function collectSqlFiles(root: string, directory: string, output: Array<{ path: string; sqlPayload: string }>): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) await collectSqlFiles(root, fullPath, output);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sql')) output.push({ path: relative(root, fullPath).replaceAll('\\', '/'), sqlPayload: await readFile(fullPath, 'utf8') });
  }
}

export async function syncProjectSource(store: Store, projectId: string, gitRef: string | undefined, actorId: string) {
  const projects = await store.listProjects();
  const project = projects.find((item) => item.id === projectId);
  if (!project) throw new Error('PROJECT_NOT_FOUND');
  const ref = gitRef ?? project.defaultRef;
  const url = new URL(project.repositoryUrl);
  if (url.username || url.password) throw new Error('REPOSITORY_CREDENTIALS_MUST_USE_WORKLOAD_IDENTITY');
  const workspace = await mkdtemp(join(tmpdir(), 'schemaops-git-'));
  try {
    await execFileAsync('git', ['clone', '--depth', '1', '--branch', ref, '--no-tags', project.repositoryUrl, workspace], { timeout: 120_000, maxBuffer: 1_000_000 });
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
    const message = error instanceof Error ? error.message.split('\n')[0].slice(0, 500) : 'GIT_SYNC_FAILED';
    return store.createSnapshot({ projectId, gitRef: ref, commitSha: 'unknown', sourceFingerprint: 'unknown', status: 'FAILED', errorMessage: message, createdBy: actorId, files: [] });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
