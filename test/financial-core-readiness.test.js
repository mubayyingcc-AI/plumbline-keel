'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { REQUIRED_MIGRATIONS, REQUIRED_TABLES, evaluateInventory } = require('../src/financial-core-readiness');

function readyInventory() {
  return {
    migrations: [...REQUIRED_MIGRATIONS],
    tenantTables: REQUIRED_TABLES.map(table => ({table,rlsEnabled:true,rlsForced:true,tenantPolicy:true})),
    runtimeRole: {role:'keel_runtime',rolcanlogin:true,rolinherit:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false},
    runtimeMemberships: [],
    backupRole: {exists:true,rolcanlogin:true,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false,rolconnlimit:6,canWriteLedger:false},
    backupMemberships: [{rolname:'keel_backup_reader',rolcanlogin:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false}],
    publicSecurityDefinerExecute: 0,
    databaseSsl: true,
    clientVerifiesCertificate: true,
    runtimeOwnership: {tenantTablesOwned:0,securityDefinerFunctionsOwned:0,publicSchemaOwnedByRuntime:false,unsafeSecurityDefinerFunctions:0}
  };
}

test('complete inventory passes only when all database assurance gates pass', () => {
  const result = evaluateInventory(readyInventory());
  assert.equal(result.status,'STRUCTURE_READY');
  assert.equal(result.databaseReadiness,'PASS');
  assert.equal(result.promotionEligible,false);
  assert.equal(result.releaseApproval,'NOT_ASSESSED');
  assert.ok(result.gates.every(item => item.status === 'PASS'));
});

test('missing migration is a hard block and is named', () => {
  const input = readyInventory();
  input.migrations = input.migrations.filter(name => name !== '023_backup_role_connection_capacity.sql');
  const result = evaluateInventory(input);
  const gate = result.gates.find(item => item.id === 'migration_manifest');
  assert.equal(result.status,'BLOCKED');
  assert.deepEqual(gate.missing,['023_backup_role_connection_capacity.sql']);
});

test('missing, unforced or policy-less tenant table is a hard block', () => {
  const input = readyInventory();
  input.tenantTables = input.tenantTables.filter(row => row.table !== 'keel_provider_inbox');
  input.tenantTables[0] = {...input.tenantTables[0],rlsForced:false};
  const result = evaluateInventory(input);
  assert.equal(result.status,'BLOCKED');
  assert.ok(result.gates.find(item=>item.id==='required_financial_core_tables').missing.includes('keel_provider_inbox'));
  assert.ok(result.gates.find(item=>item.id==='tenant_rls_inventory').unsafeTables.length > 0);
});

test('privileged or unexpected runtime role membership blocks readiness', () => {
  const input = readyInventory();
  input.runtimeMemberships = [{rolname:'keel_auth_owner',rolbypassrls:true}];
  const result = evaluateInventory(input);
  assert.equal(result.gates.find(item=>item.id==='runtime_role').status,'FAIL');
});

test('backup privilege, public definer execute and unverified TLS each block readiness', () => {
  const input = readyInventory();
  input.backupRole.canWriteLedger = true;
  input.publicSecurityDefinerExecute = 1;
  input.clientVerifiesCertificate = false;
  const result = evaluateInventory(input);
  for (const id of ['backup_role','security_definer_public_grants','database_tls']) {
    assert.equal(result.gates.find(item=>item.id===id).status,'FAIL',id);
  }
});

test('unknown or empty inventory can never be promoted', () => {
  const result = evaluateInventory({});
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.databaseReadiness,'FAIL');
  assert.equal(result.promotionEligible,false);
  assert.ok(result.gates.some(item=>item.status==='FAIL'));
});

test('readiness manifest is versioned and contains no duplicate required objects', () => {
  assert.deepEqual(REQUIRED_MIGRATIONS, [
    '012_double_entry_ledger.sql','013_ledger_posting_and_reservations.sql',
    '014_accounting_books_and_periods.sql','015_period_close_dual_control.sql',
    '016_global_tenant_rls_and_auth.sql','017_provider_outbox_inbox_reconciliation.sql',
    '018_keel_authority_action_assurance.sql','019_kAAA_provider_authority_event_type.sql',
    '020_rls_aware_backup_identity.sql','021_ai_release_assessments.sql',
    '022_direct_tenant_fk_coverage.sql','023_backup_role_connection_capacity.sql'
  ]);
  assert.equal(new Set(REQUIRED_TABLES).size, REQUIRED_TABLES.length);
});

test('backup login cannot inherit an unsafe reader role or nested role grant', () => {
  const input = readyInventory();
  input.backupMemberships = [
    {rolname:'keel_backup_reader',rolcanlogin:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false},
    {rolname:'keel_backup_admin',rolcanlogin:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false}
  ];
  assert.equal(evaluateInventory(input).gates.find(item=>item.id==='backup_role').status,'FAIL');
  input.backupMemberships = [
    {rolname:'keel_backup_reader',rolcanlogin:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:true}
  ];
  assert.equal(evaluateInventory(input).gates.find(item=>item.id==='backup_role').status,'FAIL');
});

test('runtime role inheritance and ownership of protected objects block readiness', () => {
  const input = readyInventory();
  input.runtimeRole.rolinherit = true;
  assert.equal(evaluateInventory(input).gates.find(item=>item.id==='runtime_role').status,'FAIL');
  input.runtimeRole.rolinherit = false;
  input.runtimeOwnership.publicSchemaOwnedByRuntime = true;
  assert.equal(evaluateInventory(input).gates.find(item=>item.id==='runtime_object_ownership').status,'FAIL');
});
