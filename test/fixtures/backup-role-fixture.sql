-- Run as a database administrator against a disposable CI database.
CREATE ROLE keel_auth_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
CREATE TABLE public.keel_tenants (tenant_id uuid PRIMARY KEY, tenant_name text NOT NULL);
CREATE TABLE public.keel_ledger_journals (tenant_id uuid NOT NULL, journal_id text NOT NULL, PRIMARY KEY(tenant_id,journal_id));
ALTER TABLE public.keel_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keel_tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY keel_tenants_tenant_isolation ON public.keel_tenants
  USING (tenant_id = NULLIF(current_setting('keel.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('keel.tenant_id',true),'')::uuid);
ALTER TABLE public.keel_ledger_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keel_ledger_journals FORCE ROW LEVEL SECURITY;
CREATE POLICY keel_ledger_journals_tenant_isolation ON public.keel_ledger_journals
  USING (tenant_id = NULLIF(current_setting('keel.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('keel.tenant_id',true),'')::uuid);
GRANT SELECT ON public.keel_tenants TO keel_auth_owner;
INSERT INTO public.keel_tenants VALUES
 ('00000000-0000-0000-0000-000000000001','tenant-a'),
 ('00000000-0000-0000-0000-000000000002','tenant-b');
INSERT INTO public.keel_ledger_journals VALUES
 ('00000000-0000-0000-0000-000000000001','journal-a'),
 ('00000000-0000-0000-0000-000000000002','journal-b');

-- Legacy NULL ownership must be visible to the narrow backup integrity audit.
CREATE TABLE public.keel_legacy_unassigned (
  legacy_id text PRIMARY KEY,
  tenant_id uuid
);
ALTER TABLE public.keel_legacy_unassigned ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keel_legacy_unassigned FORCE ROW LEVEL SECURITY;
CREATE POLICY keel_legacy_unassigned_tenant_isolation ON public.keel_legacy_unassigned
  USING (tenant_id = NULLIF(current_setting('keel.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('keel.tenant_id',true),'')::uuid);
INSERT INTO public.keel_legacy_unassigned(legacy_id,tenant_id) VALUES ('legacy-null',NULL);

-- Global reference data is exported once, independently of tenant RLS.
CREATE TABLE public.keel_global_reference (
  id BIGSERIAL PRIMARY KEY,
  reference_key text NOT NULL UNIQUE,
  reference_value text NOT NULL
);
INSERT INTO public.keel_global_reference(reference_key,reference_value)
VALUES ('currency-usd','USD'),('currency-ngn','NGN');
