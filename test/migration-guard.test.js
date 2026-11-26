'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { REQUIRED_MIGRATIONS } = require('../src/financial-core-contract');

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

test('guarded migration runner includes the full core migration sequence', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'apply-ledger-migrations.js'), 'utf8');
  assert.match(script, /require\(['"]\.\.\/src\/financial-core-contract['"]\)/);
  assert.match(script, /for \(const version of REQUIRED_MIGRATIONS\)/);
  assert.ok(REQUIRED_MIGRATIONS.length >= 12, 'expected the complete financial-core migration sequence');
});
