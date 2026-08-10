import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMigrationFile, parseMigrationFiles } from './migration-parser.js';
import { checksumSql } from './domain.js';

test('parses versioned, repeatable and undo migration conventions', () => {
  assert.deepEqual(parseMigrationFile('migrations/V1__init.sql', 'select 1;'), {
    path: 'migrations/V1__init.sql', kind: 'VERSIONED', version: '1', description: 'init', checksum: checksumSql('select 1;'), sqlPayload: 'select 1;',
  });
});

test('sorts versioned migrations before repeatables and rejects duplicate identities', () => {
  const parsed = parseMigrationFiles([
    { path: 'R__refresh.sql', sqlPayload: 'select 1' },
    { path: 'V2__second.sql', sqlPayload: 'select 2' },
    { path: 'U1__undo.sql', sqlPayload: 'select 0' },
    { path: 'V1__first.sql', sqlPayload: 'select 1' },
  ]);
  assert.deepEqual(parsed.map((item) => `${item.kind}:${item.version ?? item.path}`), ['VERSIONED:1', 'VERSIONED:2', 'UNDO:1', 'REPEATABLE:R__refresh.sql']);
  assert.throws(() => parseMigrationFiles([{ path: 'V1__a.sql', sqlPayload: '1' }, { path: 'V1__b.sql', sqlPayload: '2' }]), /DUPLICATE_MIGRATION_IDENTITY/);
});
