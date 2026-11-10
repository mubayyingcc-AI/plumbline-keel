
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('ledger migration runner refuses production even when migration flag is set', () => {
  const script = path.join(__dirname, '..', 'scripts', 'apply-ledger-migrations.js');
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      RAILWAY_ENVIRONMENT_NAME: 'production',
      KEEL_ALLOW_STAGING_MIGRATIONS: 'true',
      KEEL_RUNTIME_DB_PASSWORD: 'not-a-real-production-secret'
    }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ledger_migrations_refused_outside_explicit_staging_target/);
});
