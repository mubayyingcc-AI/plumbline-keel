'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { REQUIRED_MIGRATIONS, REQUIRED_TABLES, REQUIRED_FUNCTIONS, evaluateInventory } = require('../src/financial-core-readiness');

function readyInventory() {
  return {
    migrations: [...REQUIRED_MIGRATIONS],
    functions: [...REQUIRED_FUNCTIONS],
    functionDetails: REQUIRED_FUNCTIONS.map(name => ({name,owner:'keel_auth_owner',securityDefiner:true,fixedSearchPath:true})),
    relations: REQUIRED_TABLES.map(name => ({name,owner:'keel_migrator',runtimePrivileges:true,backupReadOnly:true})),
    tenantTables: REQUIRED_TABLES.map(table => ({table,tenantIdType:'uuid',rlsEnabled:true,rlsForced:true,tenantPolicy:true})),
    runtimeRole: {role:'keel_runtime',rolcanlogin:true,rolinherit:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false},
    runtimeMemberships: [],
    backupRole: {exists:true,rolcanlogin:true,rolinherit:true,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false,rolconnlimit:6,canWriteLedger:false},
    backupMemberships: [{rolname:'keel_backup_reader',rolcanlogin:false,rolinherit:true,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false}],
    publicSecurityDefinerExecute: 0,
    databaseSsl: true,
    clientVerifiesCertificate: true,
    runtimeOwnership: {publicRelationsOwned:0,securityDefinerFunctionsOwned:0,publicSchemaOwnedByRuntime:false,unsafeSecurityDefinerFunctions:0},
    authOwner: {exists:true,rolcanlogin:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:true,member_count:0,inherited_role_count:0},
    schemaPrivileges: {publicCreate:false,runtimeCreate:false,backupCreate:false},
    unsafeSecurityDefinerGrants: 0
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
  assert.equal(REQUIRED_MIGRATIONS.length, 12);
  assert.equal(REQUIRED_MIGRATIONS[0], '012_double_entry_ledger.sql');
  assert.equal(REQUIRED_MIGRATIONS.at(-1), '023_backup_role_connection_capacity.sql');
  assert.equal(new Set(REQUIRED_TABLES).size, REQUIRED_TABLES.length);
  assert.equal(new Set(REQUIRED_FUNCTIONS).size, REQUIRED_FUNCTIONS.length);
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

test('dedicated BYPASSRLS function owner must remain non-login and unassumable', () => {
  const input = readyInventory();
  input.authOwner.member_count = 1;
  assert.equal(evaluateInventory(input).gates.find(item=>item.id==='auth_function_owner').status,'FAIL');
  input.authOwner.member_count = 0;
  input.authOwner.rolcanlogin = true;
  assert.equal(evaluateInventory(input).gates.find(item=>item.id==='auth_function_owner').status,'FAIL');
});

test('non-UUID tenant_id columns block the tenant RLS inventory', () => {
  const input = readyInventory();
  input.tenantTables[0].tenantIdType = 'text';
  assert.equal(evaluateInventory(input).gates.find(item=>item.id==='tenant_rls_inventory').status,'FAIL');
});

test('a broad additional permissive policy blocks tenant readiness', () => {
  const input = readyInventory();
  input.tenantTables[0].tenantPolicy = false;
  assert.equal(evaluateInventory(input).gates.find(item=>item.id==='tenant_rls_inventory').status,'FAIL');
});

test('public schema creation and unapproved security-definer grants block readiness', () => {
  const input = readyInventory();
  input.schemaPrivileges.publicCreate = true;
  input.unsafeSecurityDefinerGrants = 1;
  const result = evaluateInventory(input);
  assert.equal(result.gates.find(item=>item.id==='public_schema_create_privileges').status,'FAIL');
  assert.equal(result.gates.find(item=>item.id==='security_definer_public_grants').status,'FAIL');
});

test('dedicated function owner cannot inherit another role or replication privilege', () => {
  const input = readyInventory();
  input.authOwner.inherited_role_count = 1;
  assert.equal(evaluateInventory(input).gates.find(item=>item.id==='auth_function_owner').status,'FAIL');
  input.authOwner.inherited_role_count = 0;
  input.authOwner.rolreplication = true;
  assert.equal(evaluateInventory(input).gates.find(item=>item.id==='auth_function_owner').status,'FAIL');
});


test('migration contract is shared, versioned, unique and backed by files', () => {
  const contract = require('../src/financial-core-contract');
  const fs = require('node:fs');
  const path = require('node:path');
  assert.equal(contract.FINANCIAL_CORE_CONTRACT_VERSION, '1.2.0');
  assert.deepEqual(REQUIRED_MIGRATIONS, contract.REQUIRED_MIGRATIONS);
  assert.deepEqual(REQUIRED_TABLES, contract.REQUIRED_TABLES);
  assert.deepEqual(REQUIRED_FUNCTIONS, contract.REQUIRED_FUNCTIONS);
  assert.equal(new Set(contract.REQUIRED_MIGRATIONS).size, contract.REQUIRED_MIGRATIONS.length);
  for (const migration of contract.REQUIRED_MIGRATIONS) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'db', 'migrations', migration)), 'missing migration file: ' + migration);
  }
  const runner = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'apply-ledger-migrations.js'), 'utf8');
  assert.match(runner, /require\(['"]\.\.\/src\/financial-core-contract['"]\)/);
  assert.match(runner, /for \(const version of REQUIRED_MIGRATIONS\)/);
});


test('missing required authority, provider, regulatory and evidence functions hard-block readiness', () => {
  const input = readyInventory();
  input.functions = input.functions.filter(name => name !== 'keel_authenticate_tenant_key');
  const result = evaluateInventory(input);
  const gate = result.gates.find(item => item.id === 'required_financial_core_functions');
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(gate.missing, ['keel_authenticate_tenant_key']);
  assert.equal(result.promotionEligible, false);
});

test('the complete contract requires regulatory relations as well as ledger and provider objects', () => {
  for (const name of ['keel_regulatory_mappings', 'keel_regulatory_obligations', 'keel_provider_reconciliation_cases', 'keel_authority_action_approvals']) {
    assert.ok(REQUIRED_TABLES.includes(name), 'contract omits ' + name);
  }
});


test('missing relation, runtime grant, backup read-only posture and unsafe owner block readiness', () => {
  const input = readyInventory();
  input.relations = input.relations.filter(row => row.name !== 'keel_ledger_journals');
  let result = evaluateInventory(input);
  assert.equal(result.gates.find(item => item.id === 'required_financial_core_relations').status, 'FAIL');
  input.relations = readyInventory().relations;
  input.relations[0].runtimePrivileges = false;
  result = evaluateInventory(input);
  assert.equal(result.gates.find(item => item.id === 'required_financial_core_relations').status, 'FAIL');
  input.relations[0].runtimePrivileges = true;
  input.relations[0].backupReadOnly = false;
  result = evaluateInventory(input);
  assert.equal(result.gates.find(item => item.id === 'required_financial_core_relations').status, 'FAIL');
  input.relations[0].backupReadOnly = true;
  input.relations[0].owner = 'keel_runtime';
  result = evaluateInventory(input);
  assert.equal(result.gates.find(item => item.id === 'required_financial_core_relations').status, 'FAIL');
});

test('security-definer functions require dedicated owner and fixed search_path', () => {
  const input = readyInventory();
  input.functionDetails[0].owner = 'keel_runtime';
  let result = evaluateInventory(input);
  assert.equal(result.gates.find(item => item.id === 'required_financial_core_functions').status, 'FAIL');
  input.functionDetails[0].owner = 'keel_auth_owner';
  input.functionDetails[0].fixedSearchPath = false;
  result = evaluateInventory(input);
  assert.equal(result.gates.find(item => item.id === 'required_financial_core_functions').status, 'FAIL');
});
