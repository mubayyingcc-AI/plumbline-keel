-- Least-privilege, RLS-preserving logical-backup identity.
-- The login is created without a password. Provision its password out-of-band
-- with psql's interactive \\password command, then store the URL in Railway.
DO $keel$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='keel_backup_reader') THEN
    CREATE ROLE keel_backup_reader NOLOGIN INHERIT
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSE
    ALTER ROLE keel_backup_reader NOLOGIN INHERIT
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='keel_backup') THEN
    CREATE ROLE keel_backup LOGIN INHERIT
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      CONNECTION LIMIT 2 IN ROLE keel_backup_reader;
  ELSE
    ALTER ROLE keel_backup LOGIN INHERIT
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      CONNECTION LIMIT 2;
    GRANT keel_backup_reader TO keel_backup;
  END IF;
END
$keel$;

GRANT USAGE ON SCHEMA public TO keel_backup_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO keel_backup_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO keel_backup_reader;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM keel_backup_reader;
REVOKE USAGE, UPDATE ON ALL SEQUENCES IN SCHEMA public FROM keel_backup_reader;

DO $keel$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO keel_backup_reader', current_database());
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO keel_backup_reader',
    current_user
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON SEQUENCES TO keel_backup_reader',
    current_user
  );
END
$keel$;

-- This narrowly scoped SECURITY DEFINER function exposes tenant identifiers
-- only. It does not return tenant data or provide a general RLS bypass.
CREATE OR REPLACE FUNCTION public.keel_backup_tenant_ids()
RETURNS TABLE (tenant_id UUID)
LANGUAGE SQL
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $function$
  SELECT t.tenant_id FROM public.keel_tenants AS t ORDER BY t.tenant_id
$function$;

ALTER FUNCTION public.keel_backup_tenant_ids() OWNER TO keel_auth_owner;
REVOKE ALL ON FUNCTION public.keel_backup_tenant_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.keel_backup_tenant_ids() TO keel_backup_reader;

-- Defensive postcondition: fail migration if the login can bypass RLS or write.
DO $keel$
DECLARE v RECORD;
BEGIN
  SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls
    INTO v FROM pg_roles r WHERE r.rolname='keel_backup';
  IF v.rolsuper OR v.rolcreatedb OR v.rolcreaterole OR v.rolreplication OR v.rolbypassrls THEN
    RAISE EXCEPTION 'keel_backup_privilege_boundary_failed';
  END IF;
  IF has_table_privilege('keel_backup','public.keel_ledger_journals','INSERT')
     OR has_table_privilege('keel_backup','public.keel_ledger_journals','UPDATE')
     OR has_table_privilege('keel_backup','public.keel_ledger_journals','DELETE') THEN
    RAISE EXCEPTION 'keel_backup_write_privilege_detected';
  END IF;
END
$keel$;
