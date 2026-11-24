'use strict';

const REQUIRED_MIGRATIONS = Object.freeze([
  '012_double_entry_ledger.sql',
  '013_ledger_posting_and_reservations.sql',
  '014_accounting_books_and_periods.sql',
  '015_period_close_dual_control.sql',
  '016_global_tenant_rls_and_auth.sql',
  '017_provider_outbox_inbox_reconciliation.sql',
  '018_keel_authority_action_assurance.sql',
  '019_kAAA_provider_authority_event_type.sql',
  '020_rls_aware_backup_identity.sql',
  '021_ai_release_assessments.sql',
  '022_direct_tenant_fk_coverage.sql',
  '023_backup_role_connection_capacity.sql'
]);

const REQUIRED_TABLES = Object.freeze([
  'keel_tenants',
  'keel_tenant_keys',
  'keel_principals',
  'keel_ledger_accounts',
  'keel_ledger_journals',
  'keel_ledger_lines',
  'keel_ledger_account_balances',
  'keel_ledger_reservations',
  'keel_ledger_event_heads',
  'keel_ledger_events',
  'keel_accounting_books',
  'keel_accounting_book_accounts',
  'keel_accounting_periods',
  'keel_accounting_period_close_requests',
  'keel_accounting_period_closures',
  'keel_provider_outbox',
  'keel_provider_inbox',
  'keel_provider_reconciliation_cases',
  'keel_authority_envelopes',
  'keel_action_proof_objects',
  'keel_authority_action_approvals',
  'keel_ai_release_assessments'
]);

function gate(id, passed, detail, evidence = {}) {
  return { id, status: passed ? 'PASS' : 'FAIL', detail, ...evidence };
}

function evaluateInventory(input) {
  const migrations = new Set(input.migrations || []);
  const missingMigrations = REQUIRED_MIGRATIONS.filter(version => !migrations.has(version));
  const tables = new Map((input.tenantTables || []).map(row => [row.table, row]));
  const missingTables = REQUIRED_TABLES.filter(name => !tables.has(name));
  const unsafeRls = (input.tenantTables || []).filter(row =>
    !row.rlsEnabled || !row.rlsForced || !row.tenantPolicy
  ).map(row => row.table);
  const runtime = input.runtimeRole || {};
  const backup = input.backupRole || {};
  const runtimeMemberships = input.runtimeMemberships || [];
  const unsafeMemberships = runtimeMemberships.filter(role =>
    role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole ||
    ['keel_auth_owner', 'keel_backup', 'keel_backup_reader'].includes(role.rolname)
  ).map(role => role.rolname);
  const gates = [
    gate('migration_manifest', missingMigrations.length === 0,
      missingMigrations.length ? 'Required migrations are missing.' : 'All required migrations 012–023 are recorded.',
      { missing: missingMigrations }),
    gate('required_financial_core_tables', missingTables.length === 0,
      missingTables.length ? 'Required financial-core tables are missing.' : 'All required financial-core tables exist.',
      { missing: missingTables }),
    gate('tenant_rls_inventory', unsafeRls.length === 0,
      unsafeRls.length ? 'Tenant tables must have ENABLE RLS, FORCE RLS and a tenant-context policy.' : 'Every discovered tenant_id UUID table has forced RLS and a tenant-context policy.',
      { unsafeTables: unsafeRls, discoveredTenantTables: tables.size }),
    gate('runtime_role', runtime.role === 'keel_runtime' && runtime.rolsuper === false &&
      runtime.rolcreatedb === false && runtime.rolcreaterole === false && runtime.rolreplication === false &&
      runtime.rolbypassrls === false && unsafeMemberships.length === 0,
      'Runtime role identity, role attributes and inherited memberships must remain least-privileged.',
      { role: runtime.role || 'unknown', unsafeMemberships }),
    gate('backup_role', backup.exists === true && backup.rolcanlogin === true &&
      backup.rolsuper === false && backup.rolcreatedb === false && backup.rolcreaterole === false &&
      backup.rolreplication === false && backup.rolbypassrls === false && backup.rolconnlimit === 6 &&
      (input.backupMemberships || []).length === 1 &&
      (input.backupMemberships || [])[0] === 'keel_backup_reader' && backup.canWriteLedger !== true,
      'Dedicated backup login must be non-privileged, capped at six connections, read-only and a member only of keel_backup_reader.'),
    gate('security_definer_public_grants', input.publicSecurityDefinerExecute === 0,
      'SECURITY DEFINER functions must not be executable by PUBLIC.',
      { unsafeFunctionCount: input.publicSecurityDefinerExecute }),
    gate('database_tls', input.databaseSsl === true && input.clientVerifiesCertificate === true,
      'The active PostgreSQL connection must use TLS and the Node client must verify the server certificate.',
      { ssl: input.databaseSsl === true, certificateVerification: input.clientVerifiesCertificate === true })
  ];
  const passed = gates.every(item => item.status === 'PASS');
  return {
    status: passed ? 'STRUCTURE_READY' : 'BLOCKED',
    databaseReadiness: passed ? 'PASS' : 'FAIL',
    promotionEligible: false,
    releaseApproval: 'NOT_ASSESSED',
    scope: 'database_schema_runtime_privileges_tenant_rls_backup_identity_and_tls_only',
    gates,
    releaseGatesNotEstablished: [
      'cross-tenant positive and negative application acceptance matrix',
      'ledger exact-money, idempotency and concurrency acceptance',
      'provider-specific certification and live reconciliation evidence',
      'external evidence anchoring and independent chain verification',
      'accounting-period dual-control operational evidence',
      'isolated backup restore and point-in-time recovery drill',
      'product-by-product conformance',
      'independent security, accounting, privacy and operational review',
      'separate explicit production release approval'
    ]
  };
}

async function inspectDatabase(pool, options = {}) {
  if (!pool || typeof pool.query !== 'function') throw new Error('readiness_pool_required');
  const migrationTable = await pool.query("SELECT to_regclass('public.keel_schema_migrations') IS NOT NULL AS exists");
  if (!migrationTable.rows[0] || !migrationTable.rows[0].exists) {
    return evaluateInventory({});
  }
  const [
    migrationResult, runtimeResult, tenantTableResult, backupResult,
    backupMembershipResult, runtimeMembershipResult, functionGrantResult, tlsResult, backupWriteResult
  ] = await Promise.all([
    pool.query('SELECT version FROM public.keel_schema_migrations WHERE version = ANY($1::text[])', [REQUIRED_MIGRATIONS]),
    pool.query("SELECT current_user AS role, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user"),
    pool.query(`
      SELECT c.relname AS table, c.relrowsecurity AS "rlsEnabled",
             c.relforcerowsecurity AS "rlsForced",
             EXISTS (
               SELECT 1 FROM pg_policies p
               WHERE p.schemaname='public' AND p.tablename=c.relname
                 AND COALESCE(p.qual,'') LIKE '%keel.tenant_id%'
                 AND COALESCE(p.with_check,'') LIKE '%keel.tenant_id%'
             ) AS "tenantPolicy"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
        AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype
        AND a.attnum>0 AND NOT a.attisdropped
      ORDER BY c.relname
    `),
    pool.query("SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls, r.rolconnlimit FROM pg_roles r WHERE r.rolname='keel_backup'"),
    pool.query("SELECT granted.rolname FROM pg_auth_members m JOIN pg_roles granted ON granted.oid=m.roleid JOIN pg_roles member ON member.oid=m.member WHERE member.rolname='keel_backup' ORDER BY granted.rolname"),
    pool.query(`
      WITH RECURSIVE inherited_roles(role_oid) AS (
        SELECT oid FROM pg_roles WHERE rolname=current_user
        UNION
        SELECT m.roleid FROM pg_auth_members m JOIN inherited_roles ir ON m.member=ir.role_oid
      )
      SELECT r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls
      FROM inherited_roles ir JOIN pg_roles r ON r.oid=ir.role_oid
      WHERE r.rolname<>current_user ORDER BY r.rolname
    `),
    pool.query(`
      SELECT COUNT(*)::int AS count
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prosecdef
        AND EXISTS (
          SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f',p.proowner))) a
          WHERE a.grantee=0 AND a.privilege_type='EXECUTE'
        )
    `),
    pool.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()'),
    pool.query("SELECT (has_table_privilege('keel_backup','public.keel_ledger_journals','INSERT') OR has_table_privilege('keel_backup','public.keel_ledger_journals','UPDATE') OR has_table_privilege('keel_backup','public.keel_ledger_journals','DELETE')) AS can_write")
  ]);
  const backupRole = backupResult.rows[0] ? { exists: true, ...backupResult.rows[0] } : { exists: false };
  backupRole.canWriteLedger = backupWriteResult.rows[0] ? backupWriteResult.rows[0].can_write : true;
  const ssl = options.ssl;
  return evaluateInventory({
    migrations: migrationResult.rows.map(row => row.version),
    tenantTables: tenantTableResult.rows,
    runtimeRole: runtimeResult.rows[0] || {},
    runtimeMemberships: runtimeMembershipResult.rows,
    backupRole,
    backupMemberships: backupMembershipResult.rows.map(row => row.rolname),
    publicSecurityDefinerExecute: functionGrantResult.rows[0] ? functionGrantResult.rows[0].count : null,
    databaseSsl: tlsResult.rows[0] ? tlsResult.rows[0].ssl === true : false,
    clientVerifiesCertificate: !!ssl && typeof ssl === 'object' && ssl.rejectUnauthorized === true
  });
}

module.exports = { REQUIRED_MIGRATIONS, REQUIRED_TABLES, evaluateInventory, inspectDatabase };
