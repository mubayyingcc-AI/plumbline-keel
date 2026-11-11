'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const databaseUrl = process.env.KEEL_BACKUP_TEST_DATABASE_URL;
test('keel_backup is read-only and tenant-RLS constrained', { skip: !databaseUrl }, () => {
  const migration = path.join(__dirname, '..', 'db', 'migrations', '020_rls_aware_backup_identity.sql');
  const fixture = path.join(__dirname, 'fixtures', 'backup-role-fixture.sql');
  const run = (sql, expected = 0) => {
    const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-c', sql], { encoding: 'utf8' });
    assert.equal(result.status, expected, result.stderr || result.stdout);
    return result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || '';
  };
  const fixtureResult = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-f', fixture], { encoding: 'utf8' });
  assert.equal(fixtureResult.status, 0, fixtureResult.stderr);
  const migrationResult = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-f', migration], { encoding: 'utf8' });
  assert.equal(migrationResult.status, 0, migrationResult.stderr);
  const integrityMigration = path.join(__dirname, '..', 'db', 'migrations', '021_backup_tenant_integrity_audit.sql');
  const integrityResult = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-f', integrityMigration], { encoding: 'utf8' });
  assert.equal(integrityResult.status, 0, integrityResult.stderr);

  const attributes = run("SELECT (NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)::text FROM pg_roles WHERE rolname='keel_backup'");
  assert.equal(attributes, 'true');
  assert.equal(run("SELECT pg_has_role('keel_backup','keel_backup_reader','MEMBER')::text"), 'true');
  assert.equal(run("SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE u.rolname='keel_backup' AND r.rolname<>'keel_backup_reader'"), '0');
  assert.equal(run("SELECT has_table_privilege('keel_backup','public.keel_ledger_journals','SELECT')::text"), 'true');
  for (const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE']) {
    assert.equal(run(`SELECT has_table_privilege('keel_backup','public.keel_ledger_journals','${privilege}')::text`), 'false');
  }
  assert.equal(run("SET ROLE keel_backup; SELECT count(*) FROM public.keel_ledger_journals"), '0');
  assert.equal(run("SET ROLE keel_backup; SET keel.tenant_id='00000000-0000-0000-0000-000000000001'; SELECT string_agg(journal_id,',') FROM public.keel_ledger_journals"), 'journal-a');
  assert.equal(run("SET ROLE keel_backup; SET keel.tenant_id='00000000-0000-0000-0000-000000000002'; SELECT string_agg(journal_id,',') FROM public.keel_ledger_journals"), 'journal-b');
  assert.equal(run("SET ROLE keel_backup; SELECT count(*) FROM public.keel_backup_tenant_ids()"), '2');
  assert.equal(run("SELECT unassigned_rows||'|'||orphaned_rows FROM public.keel_backup_tenant_integrity_audit() WHERE table_name='keel_legacy_unassigned'"), '1|0');
  assert.equal(run("SELECT (NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolbypassrls AND NOT rolcanlogin)::text FROM pg_roles WHERE rolname='keel_backup_audit_owner'"), 'true');
  assert.equal(run("SELECT pg_has_role('keel_backup','keel_backup_audit_owner','MEMBER')::text"), 'false');
  run("DELETE FROM public.keel_legacy_unassigned WHERE legacy_id='legacy-null'");
  run("INSERT INTO public.keel_legacy_unassigned(legacy_id,tenant_id) VALUES ('orphan-row','00000000-0000-0000-0000-000000000099')");
  assert.equal(run("SELECT unassigned_rows||'|'||orphaned_rows FROM public.keel_backup_tenant_integrity_audit() WHERE table_name='keel_legacy_unassigned'"), '0|1');
  run("DELETE FROM public.keel_legacy_unassigned WHERE legacy_id='orphan-row'");
  assert.equal(run("SELECT unassigned_rows||'|'||orphaned_rows FROM public.keel_backup_tenant_integrity_audit() WHERE table_name='keel_legacy_unassigned'"), '0|0');

  // Exercise pg_dump's documented RLS path: row-security enabled plus INSERT
  // output. The test's admin connection is switched to keel_backup at startup.
  run("ALTER ROLE keel_backup PASSWORD 'ci-backup-password'");
  for (const [tenant, visible, hidden] of [
    ['00000000-0000-0000-0000-000000000001','journal-a','journal-b'],
    ['00000000-0000-0000-0000-000000000002','journal-b','journal-a']
  ]) {
    const dump = spawnSync('pg_dump', [
      '--dbname', databaseUrl, '--data-only', '--table=public.keel_ledger_journals',
      '--enable-row-security', '--inserts', '--no-owner', '--no-privileges'
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PGPASSWORD: 'ci-backup-password',
        PGOPTIONS: `-c role=keel_backup -c keel.tenant_id=${tenant}`
      }
    });
    assert.equal(dump.status, 0, dump.stderr);
    assert.match(dump.stdout, new RegExp(visible));
    assert.doesNotMatch(dump.stdout, new RegExp(hidden));
  }
  const write = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-c',
    "SET ROLE keel_backup; SET keel.tenant_id='00000000-0000-0000-0000-000000000001'; INSERT INTO public.keel_ledger_journals VALUES ('00000000-0000-0000-0000-000000000001','forbidden')"
  ], { encoding: 'utf8' });
  assert.notEqual(write.status, 0, 'backup identity unexpectedly inserted a ledger record');
  assert.match(write.stderr, /permission denied|new row violates row-level security/i);
  const bypass = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-c',
    "SET ROLE keel_backup; SET row_security=off; SELECT * FROM public.keel_ledger_journals"
  ], { encoding: 'utf8' });
  assert.notEqual(bypass.status, 0, 'backup identity unexpectedly disabled RLS');
  assert.match(bypass.stderr, /row-level security|permission denied/i);
});
