-- Keel production-readiness inventory (READ ONLY)
-- Compatible target: PostgreSQL 16 and 18.
-- Run only against the intended database using a read-only inspection identity.
-- This script performs catalog reads only. It does not inspect row contents,
-- alter schema, create temporary objects, change roles, or run migrations.
--
-- Recommended invocation:
--   psql "$KEEL_READONLY_AUDIT_URL" -X -v ON_ERROR_STOP=1 -f scripts/production-readiness-audit.sql
--
-- The connection identity must itself be read-only. Do not substitute DATABASE_URL
-- or the application runtime credential. Never paste connection strings or secrets
-- into tickets, chat, CI logs, or this report.
--
-- Review each result set and attach sanitized output to the release evidence pack.

BEGIN TRANSACTION READ ONLY;

-- 1. Database identity and server posture.
SELECT
  current_database() AS database_name,
  current_user AS current_role,
  session_user AS session_role,
  current_setting('server_version') AS server_version,
  current_setting('transaction_read_only') AS transaction_read_only,
  current_setting('ssl') AS ssl_in_use,
  current_setting('keel.tenant_id', true) AS transaction_tenant_context;

-- 2. Privileges of the connected role. Expected application runtime:
--    role name keel_runtime; no superuser, createdb, createrole or BYPASSRLS.
SELECT
  r.rolname,
  r.rolcanlogin,
  r.rolsuper,
  r.rolcreatedb,
  r.rolcreaterole,
  r.rolreplication,
  r.rolbypassrls,
  r.rolconnlimit,
  r.rolvaliduntil
FROM pg_roles r
WHERE r.rolname IN (current_user, session_user, 'keel_runtime', 'keel_backup')
ORDER BY r.rolname;

-- 3. Membership edges involving runtime/backup identities. Any inherited
--    elevated membership must be reviewed; do not infer safety from role flags alone.
SELECT
  member_role.rolname AS member_role,
  granted_role.rolname AS granted_role,
  m.admin_option,
  m.inherit_option,
  m.set_option
FROM pg_auth_members m
JOIN pg_roles member_role ON member_role.oid = m.member
JOIN pg_roles granted_role ON granted_role.oid = m.roleid
WHERE member_role.rolname IN ('keel_runtime','keel_backup',current_user,session_user)
   OR granted_role.rolname IN ('keel_runtime','keel_backup')
ORDER BY member_role.rolname, granted_role.rolname;

-- 4. RLS coverage for application tables. Tenant-keyed tables must have both
--    relrowsecurity and relforcerowsecurity enabled. Review every unprotected
--    tenant-bearing table; this query does not assume a fixed migration table.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relkind,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  pg_get_userbyid(c.relowner) AS owner_role
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','p')
  AND n.nspname NOT IN ('pg_catalog','information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY n.nspname, c.relname;

-- 5. RLS policy definitions. Verify tenant policies bind to transaction-local
--    context and fail closed when context is absent. Review permissive policies
--    and OR-combinations carefully.
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname NOT IN ('pg_catalog','information_schema')
ORDER BY schemaname, tablename, policyname;

-- 6. Explicit grants to the runtime and backup identities. Look for broad
--    schema/table/sequence/function grants, ownership, and mutation privileges.
SELECT
  grantee,
  table_schema,
  table_name,
  privilege_type,
  is_grantable
FROM information_schema.role_table_grants
WHERE grantee IN ('keel_runtime','keel_backup',current_user,session_user)
ORDER BY grantee, table_schema, table_name, privilege_type;

SELECT
  grantee,
  object_schema,
  object_name,
  privilege_type,
  is_grantable
FROM information_schema.role_routine_grants
WHERE grantee IN ('keel_runtime','keel_backup',current_user,session_user)
ORDER BY grantee, object_schema, object_name, privilege_type;

-- 7. Security-definer functions and owners. Each must have a fixed safe
--    search_path, narrow EXECUTE grants and reviewed ownership.
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_userbyid(p.proowner) AS owner_role,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  has_function_privilege('keel_runtime', p.oid, 'EXECUTE') AS runtime_can_execute,
  has_function_privilege('keel_backup', p.oid, 'EXECUTE') AS backup_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY n.nspname, p.proname;

-- 8. Migration/version ledger discovery. This lists candidate migration
--    tracking tables and their columns without assuming a particular framework.
SELECT
  table_schema,
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog','information_schema')
  AND (table_name ILIKE '%migration%'
       OR table_name ILIKE '%schema%version%'
       OR table_name ILIKE '%drizzle%'
       OR table_name ILIKE '%knex%')
ORDER BY table_schema, table_name, ordinal_position;

-- 9. Financial-core object inventory. Presence is not proof of correct migration
--    or data; compare this list with the repository's migration manifest.
SELECT
  n.nspname AS schema_name,
  c.relname AS object_name,
  c.relkind,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
  AND (
    c.relname LIKE 'keel_ledger_%'
    OR c.relname LIKE 'keel_accounting_%'
    OR c.relname LIKE 'keel_provider_%'
    OR c.relname LIKE 'keel_reconciliation_%'
    OR c.relname LIKE 'keel_authority_%'
    OR c.relname LIKE 'keel_assurance_%'
    OR c.relname LIKE 'keel_tenant_%'
    OR c.relname LIKE 'keel_backup_%'
  )
ORDER BY n.nspname, c.relname;

-- 10. Constraints and indexes for financial-core tables. Validate uniqueness,
--     deferred constraints, foreign keys and index validity against migration SQL.
SELECT
  n.nspname AS schema_name,
  t.relname AS table_name,
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  con.convalidated AS validated,
  pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
JOIN pg_class t ON t.oid = con.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
  AND (t.relname LIKE 'keel_ledger_%'
       OR t.relname LIKE 'keel_accounting_%'
       OR t.relname LIKE 'keel_provider_%'
       OR t.relname LIKE 'keel_reconciliation_%')
ORDER BY n.nspname, t.relname, con.conname;

SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname NOT IN ('pg_catalog','information_schema')
  AND (tablename LIKE 'keel_ledger_%'
       OR tablename LIKE 'keel_accounting_%'
       OR tablename LIKE 'keel_provider_%'
       OR tablename LIKE 'keel_reconciliation_%')
ORDER BY schemaname, tablename, indexname;

-- 11. Database-level connection security and ownership.
SELECT
  d.datname,
  pg_get_userbyid(d.datdba) AS database_owner,
  d.datallowconn,
  d.datconnlimit
FROM pg_database d
WHERE d.datname = current_database();

-- No writes have been issued. End the read-only transaction explicitly.
ROLLBACK;
