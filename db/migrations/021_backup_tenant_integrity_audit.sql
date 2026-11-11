-- Narrow backup preflight: detect legacy unassigned and orphaned tenant rows
-- without granting the backup login RLS bypass or exposing row contents.
DO $keel$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='keel_backup_audit_owner') THEN
    CREATE ROLE keel_backup_audit_owner NOLOGIN INHERIT
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
  ELSE
    ALTER ROLE keel_backup_audit_owner NOLOGIN INHERIT
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
  END IF;
END
$keel$;

GRANT USAGE ON SCHEMA public TO keel_backup_audit_owner;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO keel_backup_audit_owner;

DO $keel$
BEGIN
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO keel_backup_audit_owner',
    current_user
  );
END
$keel$;

CREATE OR REPLACE FUNCTION public.keel_backup_tenant_integrity_audit()
RETURNS TABLE (table_name TEXT, unassigned_rows BIGINT, orphaned_rows BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $function$
DECLARE
  v_table RECORD;
  v_unassigned BIGINT;
  v_orphaned BIGINT;
BEGIN
  FOR v_table IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype
      AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'SELECT count(*) FILTER (WHERE x.tenant_id IS NULL), ' ||
      'count(*) FILTER (WHERE x.tenant_id IS NOT NULL AND NOT EXISTS ' ||
      '(SELECT 1 FROM public.keel_tenants t WHERE t.tenant_id=x.tenant_id)) ' ||
      'FROM public.%I x',
      v_table.relname
    ) INTO v_unassigned,v_orphaned;
    RETURN QUERY SELECT v_table.relname,v_unassigned,v_orphaned;
  END LOOP;
END
$function$;

ALTER FUNCTION public.keel_backup_tenant_integrity_audit() OWNER TO keel_backup_audit_owner;
REVOKE ALL ON FUNCTION public.keel_backup_tenant_integrity_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.keel_backup_tenant_integrity_audit() TO keel_backup_reader;

DO $keel$
DECLARE v RECORD;
BEGIN
  SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolcanlogin
    INTO v FROM pg_roles r WHERE r.rolname='keel_backup_audit_owner';
  IF v.rolsuper OR v.rolcreatedb OR v.rolcreaterole OR v.rolreplication OR NOT v.rolbypassrls OR v.rolcanlogin THEN
    RAISE EXCEPTION 'keel_backup_audit_owner_privilege_boundary_failed';
  END IF;
  IF pg_has_role('keel_backup','keel_backup_audit_owner','MEMBER') THEN
    RAISE EXCEPTION 'keel_backup_must_not_inherit_audit_owner';
  END IF;
END
$keel$;
