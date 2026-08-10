import { checksumSql, type MigrationFile, type MigrationKind } from './domain.js';

export type ParsedMigration = Omit<MigrationFile, 'id' | 'snapshotId' | 'createdAt'>;

const versioned = /^V(?<version>[0-9]+(?:[._-][0-9A-Za-z]+)*)__?(?<description>.+)\.sql$/i;
const repeatable = /^R__(?<description>.+)\.sql$/i;
const undo = /^U(?<version>[0-9]+(?:[._-][0-9A-Za-z]+)*)__?(?<description>.+)\.sql$/i;

function normalizePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) throw new Error(`INVALID_MIGRATION_PATH:${path}`);
  return normalized;
}

function matchName(name: string): { kind: MigrationKind; version?: string; description: string } | undefined {
  for (const [kind, pattern] of [['VERSIONED', versioned], ['REPEATABLE', repeatable], ['UNDO', undo]] as const) {
    const match = pattern.exec(name);
    if (match?.groups?.description) {
      return { kind, version: match.groups.version, description: match.groups.description.replaceAll('_', ' ').trim() };
    }
  }
  return undefined;
}

export function parseMigrationFile(path: string, sqlPayload: string): ParsedMigration {
  const normalizedPath = normalizePath(path);
  const parsed = matchName(normalizedPath.split('/').at(-1) ?? '');
  if (!parsed) throw new Error(`UNSUPPORTED_MIGRATION_FILENAME:${normalizedPath}`);
  return { ...parsed, path: normalizedPath, checksum: checksumSql(sqlPayload), sqlPayload };
}

export function parseMigrationFiles(files: Array<{ path: string; sqlPayload: string }>): ParsedMigration[] {
  const parsed = files.map((file) => parseMigrationFile(file.path, file.sqlPayload));
  const identities = new Set<string>();
  for (const file of parsed) {
    const identity = `${file.kind}:${file.version ?? file.path}`;
    if (identities.has(identity)) throw new Error(`DUPLICATE_MIGRATION_IDENTITY:${identity}`);
    identities.add(identity);
  }
  return parsed.sort((a, b) => {
    const rank = (kind: MigrationKind) => kind === 'VERSIONED' ? 0 : kind === 'UNDO' ? 1 : 2;
    if (rank(a.kind) !== rank(b.kind)) return rank(a.kind) - rank(b.kind);
    return (a.version ?? '').localeCompare(b.version ?? '', undefined, { numeric: true }) || a.path.localeCompare(b.path);
  });
}

export function migrationIdentity(file: Pick<ParsedMigration, 'kind' | 'version' | 'path'>): string {
  return `${file.kind}:${file.version ?? file.path}`;
}
