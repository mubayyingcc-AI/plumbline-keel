-- Infrastructure Finance & Assurance v1: tenant-scoped project registry and immutable assessment history.
CREATE TABLE IF NOT EXISTS public.keel_infrastructure_projects (
 tenant_id UUID NOT NULL REFERENCES public.keel_tenants(tenant_id),
 project_id TEXT NOT NULL CHECK(project_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$'),
 display_name TEXT NOT NULL,
 currency CHAR(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','closed')),
 created_by UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,project_id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES public.keel_principals(tenant_id,principal_id)
);
CREATE TABLE IF NOT EXISTS public.keel_infrastructure_assessments (
 tenant_id UUID NOT NULL REFERENCES public.keel_tenants(tenant_id),
 assessment_id UUID NOT NULL,
 project_id TEXT NOT NULL,
 schema_version TEXT NOT NULL CHECK(schema_version='keel.infrastructure-finance-assessment.v1'),
 input_fingerprint CHAR(64) NOT NULL CHECK(input_fingerprint ~ '^[a-f0-9]{64}$'),
 result_fingerprint CHAR(64) NOT NULL CHECK(result_fingerprint ~ '^[a-f0-9]{64}$'),
 input_payload JSONB NOT NULL CHECK(jsonb_typeof(input_payload)='object'),
 result_payload JSONB NOT NULL CHECK(jsonb_typeof(result_payload)='object'),
 created_by UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,assessment_id),
 UNIQUE(tenant_id,project_id,input_fingerprint),
 FOREIGN KEY(tenant_id,project_id) REFERENCES public.keel_infrastructure_projects(tenant_id,project_id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES public.keel_principals(tenant_id,principal_id)
);
CREATE INDEX IF NOT EXISTS keel_infrastructure_assessments_history_idx ON public.keel_infrastructure_assessments(tenant_id,project_id,created_at DESC);
DO $keel$
DECLARE t TEXT;
BEGIN
 FOREACH t IN ARRAY ARRAY['keel_infrastructure_projects','keel_infrastructure_assessments'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',t||'_tenant_isolation',t);
  EXECUTE format('CREATE POLICY %I ON public.%I USING (tenant_id=NULLIF(current_setting(''keel.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=NULLIF(current_setting(''keel.tenant_id'',true),'''')::uuid)',t||'_tenant_isolation',t);
 END LOOP;
END
$keel$;
