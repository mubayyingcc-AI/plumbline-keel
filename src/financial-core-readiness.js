'use strict';

const { FINANCIAL_CORE_CONTRACT_VERSION, REQUIRED_MIGRATIONS, REQUIRED_TABLES } = require('./financial-core-contract');

function gate(id, passed, detail, evidence = {}) {
  return { id, status: passed ? 'PASS' : 'FAIL', detail, ...evidence };
}

function evaluateInventory(input) {
  const migrations = new Set(input.migrations || []);
  const missingMigrations = REQUIRED_MIGRATIONS.filter(version => !migrations.has(version));
  const tables = new Map((input.tenantTables || []).map(row => [row.table, row]));
  const missingTables = REQUIRED_TABLES.filter(name => !tables.has(name));
  const unsafeRls = (input.tenantTables || []).filter(row =>
    !row.rlsEnabled || !row.rlsForced || !row.tenantPolicy || row.tenantIdType !== 'uuid'
  ).map(row => row.table);
  const runtime = input.runtimeRole || {};
  const backup = input.backupRole || {};
  const runtimeMemberships = input.runtimeMemberships || [];
  const unsafeMemberships = runtimeMemberships.map(role => role.rolname);
  const runtimeOwnership = input.runtimeOwnership || {};
  const authOwner = input.authOwner || {};
  const schemaPrivileges = input.schemaPrivileges || {};
  const unsafeBackupMemberships = (input.backupMemberships || []).filter(role => role.rolname !== 'keel_backup_reader' || role.rolcanlogin !== false || role.rolinherit !== true || role.rolsuper !== false || role.rolcreatedb !== false || role.rolcreaterole !== false || role.rolreplication !== false || role.rolbypassrls !== false).map(role => role.rolname);
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
    gate('runtime_role', runtime.role === 'keel_runtime' && runtime.rolcanlogin === true && runtime.rolinherit === false && runtime.rolsuper === false &&
      runtime.rolcreatedb === false && runtime.rolcreaterole === false && runtime.rolreplication === false &&
      runtime.rolbypassrls === false && unsafeMemberships.length === 0,
      'Runtime role identity, role attributes and inherited memberships must remain least-privileged.',
      { role: runtime.role || 'unknown', unsafeMemberships }),
    gate('auth_function_owner', authOwner.exists === true && authOwner.rolcanlogin === false && authOwner.rolsuper === false && authOwner.rolcreatedb === false && authOwner.rolcreaterole === false && authOwner.rolreplication === false && authOwner.rolbypassrls === true && authOwner.member_count === 0 && authOwner.inherited_role_count === 0, 'Dedicated BYPASSRLS function owner must be non-login and not assumable through role membership.', authOwner),
    gate('runtime_object_ownership', runtimeOwnership.publicRelationsOwned === 0 && runtimeOwnership.securityDefinerFunctionsOwned === 0 && runtimeOwnership.publicSchemaOwnedByRuntime === false && runtimeOwnership.unsafeSecurityDefinerFunctions === 0,
      'The runtime login must not own public relations, the public schema or SECURITY DEFINER functions; privileged functions must use the dedicated owner and fixed search_path.', runtimeOwnership),
    gate('backup_role', backup.exists === true && backup.rolcanlogin === true && backup.rolinherit === true &&
      backup.rolsuper === false && backup.rolcreatedb === false && backup.rolcreaterole === false &&
      backup.rolreplication === false && backup.rolbypassrls === false && backup.rolconnlimit === 6 &&
      (input.backupMemberships || []).length === 1 && unsafeBackupMemberships.length === 0 && backup.canWriteLedger !== true,
      'Dedicated backup login must be non-privileged, capped at six connections, read-only and a member only of a non-login, non-privileged keel_backup_reader.',
      { unsafeInheritedRoles: unsafeBackupMemberships }),
    gate('public_schema_create_privileges', schemaPrivileges.publicCreate === false && schemaPrivileges.runtimeCreate === false && schemaPrivileges.backupCreate === false,
      'PUBLIC, runtime and backup identities must not be able to create objects in the public schema.', schemaPrivileges),
    gate('security_definer_public_grants', input.publicSecurityDefinerExecute === 0 && input.unsafeSecurityDefinerGrants === 0,
      'SECURITY DEFINER functions must not be executable by PUBLIC or granted outside the explicit runtime/backup allowlist.',
      { unsafeFunctionCount: input.publicSecurityDefinerExecute, unsafeGrants: input.unsafeSecurityDefinerGrants }),
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
    contractVersion: FINANCIAL_CORE_CONTRACT_VERSION,
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
    backupMembershipResult, runtimeMembershipResult, functionGrantResult, tlsResult, backupWriteResult, runtimeOwnershipResult, authOwnerResult, schemaPrivilegeResult, definerGrantResult
  ] = await Promise.all([
    pool.query('SELECT version FROM public.keel_schema_migrations WHERE version = ANY($1::text[])', [REQUIRED_MIGRATIONS]),
    pool.query("SELECT current_user AS role, r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user"),
    pool.query(`
      SELECT c.relname AS table, format_type(a.atttypid,a.atttypmod) AS "tenantIdType", c.relrowsecurity AS "rlsEnabled",
             c.relforcerowsecurity AS "rlsForced",
             EXISTS (
               SELECT 1 FROM pg_policies p
               WHERE p.schemaname='public' AND p.tablename=c.relname AND p.permissive='PERMISSIVE'
                 AND (p.roles @> ARRAY['public']::name[] OR p.roles @> ARRAY['keel_runtime']::name[])
                 AND (
                   p.cmd IN ('ALL','SELECT','UPDATE','DELETE')
                   AND regexp_replace(lower(COALESCE(p.qual,'')), '[[:space:]()]|::text', '', 'g')
                     = 'tenant_id=nullif(current_setting(''keel.tenant_id'',true),'''')::uuid'
                 )
                 AND (
                   p.cmd IN ('ALL','INSERT','UPDATE')
                   AND regexp_replace(lower(COALESCE(p.with_check,'')), '[[:space:]()]|::text', '', 'g')
                     = 'tenant_id=nullif(current_setting(''keel.tenant_id'',true),'''')::uuid'
                   OR p.cmd IN ('SELECT','DELETE')
                 )
             )
             AND NOT EXISTS (
               SELECT 1 FROM pg_policies p
               WHERE p.schemaname='public' AND p.tablename=c.relname AND p.permissive='PERMISSIVE'
                 AND (p.roles @> ARRAY['public']::name[] OR p.roles @> ARRAY['keel_runtime']::name[])
                 AND (
                   (p.cmd IN ('ALL','SELECT','UPDATE','DELETE')
                     AND regexp_replace(lower(COALESCE(p.qual,'')), '[[:space:]()]|::text', '', 'g')
                       <> 'tenant_id=nullif(current_setting(''keel.tenant_id'',true),'''')::uuid')
                   OR
                   (p.cmd IN ('ALL','INSERT','UPDATE')
                     AND regexp_replace(lower(COALESCE(p.with_check,'')), '[[:space:]()]|::text', '', 'g')
                       <> 'tenant_id=nullif(current_setting(''keel.tenant_id'',true),'''')::uuid')
                 )
             ) AS "tenantPolicy"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
        AND a.attname='tenant_id'
        AND a.attnum>0 AND NOT a.attisdropped
      ORDER BY c.relname
    `),
    pool.query("SELECT r.rolname, r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls, r.rolconnlimit FROM pg_roles r WHERE r.rolname='keel_backup'"),
    pool.query(`WITH RECURSIVE backup_roles(role_oid) AS (SELECT oid FROM pg_roles WHERE rolname='keel_backup' UNION SELECT m.roleid FROM pg_auth_members m JOIN backup_roles br ON m.member=br.role_oid) SELECT r.rolname,r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls FROM backup_roles br JOIN pg_roles r ON r.oid=br.role_oid WHERE r.rolname<>'keel_backup' ORDER BY r.rolname`),
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
    pool.query(`SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='keel_backup') THEN (EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','f') AND (has_table_privilege('keel_backup',c.oid,'INSERT') OR has_table_privilege('keel_backup',c.oid,'UPDATE') OR has_table_privilege('keel_backup',c.oid,'DELETE') OR has_table_privilege('keel_backup',c.oid,'TRUNCATE') OR has_table_privilege('keel_backup',c.oid,'REFERENCES') OR has_table_privilege('keel_backup',c.oid,'TRIGGER'))) OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S' AND (has_sequence_privilege('keel_backup',c.oid,'USAGE') OR has_sequence_privilege('keel_backup',c.oid,'UPDATE')))) ELSE TRUE END AS can_write`),
    pool.query(`SELECT
      (SELECT COUNT(*)::int FROM pg_class c WHERE c.relowner=r.oid AND c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m','S','f')) AS "publicRelationsOwned",
      (SELECT COUNT(*)::int FROM pg_proc p WHERE p.proowner=r.oid AND p.pronamespace='public'::regnamespace AND p.prosecdef) AS "securityDefinerFunctionsOwned",
      (SELECT n.nspowner=r.oid FROM pg_namespace n WHERE n.nspname='public') AS "publicSchemaOwnedByRuntime",
      (SELECT COUNT(*)::int FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner
        WHERE p.pronamespace='public'::regnamespace AND p.prosecdef
          AND (owner.rolname<>'keel_auth_owner' OR NOT EXISTS (
            SELECT 1 FROM unnest(COALESCE(p.proconfig,ARRAY[]::text[])) cfg WHERE replace(lower(cfg),' ','')='search_path=pg_catalog,public'
          ))
      ) AS "unsafeSecurityDefinerFunctions"
      FROM pg_roles r WHERE r.rolname=current_user`),
    pool.query(`SELECT
      EXISTS (SELECT 1 FROM aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='CREATE') AS public_create,
      CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='keel_runtime') THEN has_schema_privilege('keel_runtime','public','CREATE') ELSE TRUE END AS runtime_create,
      CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='keel_backup') THEN has_schema_privilege('keel_backup','public','CREATE') ELSE TRUE END AS backup_create
      FROM pg_namespace n WHERE n.nspname='public'`),
    pool.query(`SELECT COUNT(*)::int AS count
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
      JOIN pg_roles grantee ON grantee.oid=acl.grantee
      WHERE n.nspname='public' AND p.prosecdef AND acl.privilege_type='EXECUTE'
        AND acl.grantee<>p.proowner
        AND NOT (
          (grantee.rolname='keel_runtime' AND p.oid IN (to_regprocedure('public.keel_authenticate_tenant_key(text)'),to_regprocedure('public.keel_touch_tenant_key(text,uuid)')))
          OR (grantee.rolname='keel_backup_reader' AND p.oid=to_regprocedure('public.keel_backup_tenant_ids()'))
        )`),
    pool.query(`WITH RECURSIVE
      auth_owner_members(member_oid) AS (
        SELECT m.member FROM pg_auth_members m JOIN pg_roles owner ON owner.oid=m.roleid WHERE owner.rolname='keel_auth_owner'
        UNION
        SELECT m.member FROM pg_auth_members m JOIN auth_owner_members aom ON m.roleid=aom.member_oid
      ),
      auth_owner_inherited_roles(role_oid) AS (
        SELECT oid FROM pg_roles WHERE rolname='keel_auth_owner'
        UNION
        SELECT m.roleid FROM pg_auth_members m JOIN auth_owner_inherited_roles aor ON m.member=aor.role_oid
      )
    SELECT TRUE AS exists,r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,
      (SELECT COUNT(DISTINCT member_oid)::int FROM auth_owner_members) AS member_count,
      (SELECT GREATEST(COUNT(DISTINCT role_oid)-1,0)::int FROM auth_owner_inherited_roles) AS inherited_role_count
    FROM pg_roles r WHERE r.rolname='keel_auth_owner'`)
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
    backupMemberships: backupMembershipResult.rows,
    publicSecurityDefinerExecute: functionGrantResult.rows[0] ? functionGrantResult.rows[0].count : null,
    databaseSsl: tlsResult.rows[0] ? tlsResult.rows[0].ssl === true : false,
    clientVerifiesCertificate: !!ssl && typeof ssl === 'object' && ssl.rejectUnauthorized === true,
    runtimeOwnership: runtimeOwnershipResult.rows[0] || {publicRelationsOwned:null,securityDefinerFunctionsOwned:null},
    authOwner: authOwnerResult.rows[0] || {exists:false},
    schemaPrivileges: schemaPrivilegeResult.rows[0] ? {publicCreate:schemaPrivilegeResult.rows[0].public_create,runtimeCreate:schemaPrivilegeResult.rows[0].runtime_create,backupCreate:schemaPrivilegeResult.rows[0].backup_create} : {},
    unsafeSecurityDefinerGrants: definerGrantResult.rows[0] ? definerGrantResult.rows[0].count : null
  });
}

module.exports = { REQUIRED_MIGRATIONS, REQUIRED_TABLES, evaluateInventory, inspectDatabase };
