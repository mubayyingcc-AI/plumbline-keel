-- Unified tenant boundary for every tenant-keyed data table.
-- Existing NULL-tenant legacy rows remain preserved but are invisible to the runtime role.
-- New rows cannot omit tenant_id; historical rows require explicit ownership adjudication.
DO $keel$
DECLARE t RECORD; null_rows BIGINT; constraint_name TEXT;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype
      AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t.relname);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t.relname);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',t.relname||'_tenant_isolation',t.relname);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I USING (tenant_id = NULLIF(current_setting(''keel.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''keel.tenant_id'',true),'''')::uuid)',
      t.relname||'_tenant_isolation',t.relname
    );
    EXECUTE format('SELECT COUNT(*) FROM public.%I WHERE tenant_id IS NULL',t.relname) INTO null_rows;
    IF null_rows=0 THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL',t.relname);
    ELSE
      constraint_name := left(t.relname,40)||'_tenant_id_required';
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=constraint_name AND conrelid=format('public.%I',t.relname)::regclass) THEN
        EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (tenant_id IS NOT NULL) NOT VALID',t.relname,constraint_name);
      END IF;
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id)',left(t.relname,45)||'_tenant_scope_idx',t.relname);
  END LOOP;
END
$keel$;

-- Non-login BYPASSRLS role used only as owner of the two fixed security-definer functions.
DO $keel$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='keel_auth_owner') THEN
    CREATE ROLE keel_auth_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
  ELSE
    ALTER ROLE keel_auth_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
  END IF;
END
$keel$;

GRANT SELECT ON public.keel_tenants,public.keel_tenant_keys,public.keel_principals TO keel_auth_owner;
GRANT UPDATE(last_used_at) ON public.keel_tenant_keys TO keel_auth_owner;

CREATE OR REPLACE FUNCTION public.keel_authenticate_tenant_key(p_token_hash TEXT)
RETURNS TABLE (
  tenant_id UUID, tenant_name TEXT, tenant_slug TEXT, key_id TEXT, role TEXT,
  principal_id UUID, principal_name TEXT, principal_email TEXT, identity_assurance TEXT
)
LANGUAGE SQL SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
  SELECT t.tenant_id,t.tenant_name,t.tenant_slug,k.key_id,k.role,k.principal_id,
         p.display_name,p.email,p.identity_assurance
  FROM public.keel_tenant_keys k
  JOIN public.keel_tenants t ON t.tenant_id=k.tenant_id
  LEFT JOIN public.keel_principals p
    ON p.tenant_id=k.tenant_id AND p.principal_id=k.principal_id AND p.status='active'
  WHERE k.token_hash::text=p_token_hash AND k.status='active' AND t.status='active'
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.keel_touch_tenant_key(p_key_id TEXT,p_tenant_id UUID)
RETURNS SETOF INTEGER
LANGUAGE SQL SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
  UPDATE public.keel_tenant_keys SET last_used_at=NOW()
   WHERE key_id=p_key_id AND tenant_id=p_tenant_id AND status='active'
   RETURNING 1
$function$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER FUNCTION public.keel_authenticate_tenant_key(TEXT) OWNER TO keel_auth_owner;
ALTER FUNCTION public.keel_touch_tenant_key(TEXT,UUID) OWNER TO keel_auth_owner;
REVOKE ALL ON FUNCTION public.keel_authenticate_tenant_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.keel_touch_tenant_key(TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.keel_authenticate_tenant_key(TEXT) TO keel_runtime;
GRANT EXECUTE ON FUNCTION public.keel_touch_tenant_key(TEXT,UUID) TO keel_runtime;
