'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const databaseUrl = process.env.KEEL_LEDGER_TEST_DATABASE_URL;
const { inspectDatabase } = require('../src/financial-core-readiness');

test('PostgreSQL catalog readiness enforces the required object, role and grant contract', {
  skip: !databaseUrl && 'Set KEEL_LEDGER_TEST_DATABASE_URL to the disposable restricted-runtime PostgreSQL database'
}, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const diagnostics = await pool.query(`
      SELECT tablename,cmd,roles::text AS roles,qual,with_check,
        trim(both '()' from regexp_replace(lower(COALESCE(qual,'')), '[[:space:]]|::text', '', 'g')) AS normalized_qual,
        trim(both '()' from regexp_replace(lower(COALESCE(with_check,'')), '[[:space:]]|::text', '', 'g')) AS normalized_check
      FROM pg_policies WHERE schemaname='public' AND tablename='keel_ledger_journals'
      ORDER BY policyname
    `);
    console.log('RLS policy diagnostics', JSON.stringify(diagnostics.rows));
    assert.equal(diagnostics.rows.length, 1, 'expected one canonical tenant policy');
    assert.equal(diagnostics.rows[0].normalized_qual, "tenant_id=(nullif(current_setting('keel.tenant_id',true),''))::uuid");
    assert.equal(diagnostics.rows[0].normalized_check, "tenant_id=(nullif(current_setting('keel.tenant_id',true),''))::uuid");
    const result = await inspectDatabase(pool, { ssl: false });
    const required = [
      'migration_manifest',
      'required_financial_core_tables',
      'required_financial_core_relations',
      'required_financial_core_functions',
      'tenant_rls_inventory',
      'runtime_role',
      'auth_function_owner',
      'runtime_object_ownership',
      'backup_role',
      'public_schema_create_privileges',
      'security_definer_public_grants'
    ];
    for (const id of required) {
      const gate = result.gates.find(item => item.id === id);
      assert.ok(gate, 'missing readiness gate: ' + id);
      assert.equal(gate.status, 'PASS', id + ': ' + JSON.stringify(gate));
    }
    assert.equal(result.promotionEligible, false);
    assert.equal(result.releaseApproval, 'NOT_ASSESSED');
  } finally {
    await pool.end();
  }
});
