-- Tenant-isolated, append-only AI release assessment evidence.
-- The record stores a deterministic assessment and supplied evidence references;
-- it does not authorize deployment or prove that external artifacts are authentic.
CREATE TABLE IF NOT EXISTS public.keel_ai_release_assessments (
  tenant_id UUID NOT NULL REFERENCES public.keel_tenants(tenant_id),
  assessment_id UUID NOT NULL,
  release_ref TEXT NOT NULL CHECK(length(release_ref) BETWEEN 1 AND 160),
  system_ref TEXT NOT NULL CHECK(length(system_ref) BETWEEN 1 AND 200),
  environment_ref TEXT NOT NULL CHECK(length(environment_ref) BETWEEN 1 AND 80),
  risk_tier TEXT NOT NULL CHECK(risk_tier IN ('low','moderate','high','critical')),
  decision_status TEXT NOT NULL CHECK(decision_status IN ('SAFE_TO_RELEASE','CONDITIONAL_RELEASE','HOLD')),
  proof_fingerprint CHAR(64) NOT NULL CHECK(proof_fingerprint ~ '^[a-f0-9]{64}$'),
  payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(tenant_id,assessment_id),
  UNIQUE(tenant_id,proof_fingerprint)
);
CREATE INDEX IF NOT EXISTS keel_ai_release_assessments_tenant_created_idx
  ON public.keel_ai_release_assessments(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS keel_ai_release_assessments_tenant_release_idx
  ON public.keel_ai_release_assessments(tenant_id,release_ref,created_at DESC);

ALTER TABLE public.keel_ai_release_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keel_ai_release_assessments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS keel_ai_release_assessments_tenant_isolation ON public.keel_ai_release_assessments;
CREATE POLICY keel_ai_release_assessments_tenant_isolation
  ON public.keel_ai_release_assessments
  USING (tenant_id=NULLIF(current_setting('keel.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('keel.tenant_id',true),'')::uuid);

CREATE OR REPLACE FUNCTION public.keel_reject_ai_release_assessment_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $function$
BEGIN
  RAISE EXCEPTION 'keel_ai_release_assessment_is_immutable' USING ERRCODE='55000';
END
$function$;
DROP TRIGGER IF EXISTS keel_ai_release_assessments_immutable ON public.keel_ai_release_assessments;
CREATE TRIGGER keel_ai_release_assessments_immutable
  BEFORE UPDATE OR DELETE ON public.keel_ai_release_assessments
  FOR EACH ROW EXECUTE FUNCTION public.keel_reject_ai_release_assessment_mutation();

GRANT SELECT,INSERT ON public.keel_ai_release_assessments TO keel_runtime;
REVOKE UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER
  ON public.keel_ai_release_assessments FROM keel_runtime;

DO $keel$
DECLARE r RECORD;
BEGIN
  SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls INTO r
    FROM pg_roles WHERE rolname='keel_runtime';
  IF NOT FOUND OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls THEN
    RAISE EXCEPTION 'keel_runtime_privilege_boundary_failed_for_ai_release_assessments';
  END IF;
END
$keel$;
