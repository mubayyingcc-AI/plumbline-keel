-- KAAA: scoped financial authority and immutable action evidence.
CREATE TABLE IF NOT EXISTS keel_authority_envelopes (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id),
 envelope_id UUID NOT NULL,
 grantor_principal_id UUID NOT NULL,
 grantee_principal_id UUID NOT NULL,
 scopes JSONB NOT NULL CHECK(jsonb_typeof(scopes)='array' AND jsonb_array_length(scopes)>0),
 resource_ids JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(resource_ids)='array'),
 currency CHAR(3),
 max_amount_minor NUMERIC(78,0),
 approval_required BOOLEAN NOT NULL DEFAULT FALSE,
 approver_principal_id UUID,
 valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
 allow_subdelegation BOOLEAN NOT NULL DEFAULT FALSE CHECK(allow_subdelegation=FALSE),
 envelope_fingerprint CHAR(64) NOT NULL CHECK(envelope_fingerprint ~ '^[a-f0-9]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 revoked_at TIMESTAMPTZ,
 PRIMARY KEY(tenant_id,envelope_id),
 FOREIGN KEY(tenant_id,grantor_principal_id) REFERENCES keel_principals(tenant_id,principal_id),
 FOREIGN KEY(tenant_id,grantee_principal_id) REFERENCES keel_principals(tenant_id,principal_id),
 FOREIGN KEY(tenant_id,approver_principal_id) REFERENCES keel_principals(tenant_id,principal_id),
 CHECK(grantor_principal_id<>grantee_principal_id),
 CHECK(approver_principal_id IS NULL OR approver_principal_id<>grantee_principal_id),
 CHECK((approval_required=FALSE AND approver_principal_id IS NULL) OR (approval_required=TRUE AND approver_principal_id IS NOT NULL)),
 CHECK(max_amount_minor IS NULL OR max_amount_minor>=0),
 CHECK(currency IS NULL OR currency ~ '^[A-Z]{3}$'),
 CHECK(expires_at>valid_from)
);
CREATE INDEX IF NOT EXISTS keel_authority_envelopes_grantee_idx ON keel_authority_envelopes(tenant_id,grantee_principal_id,status,expires_at);
CREATE TABLE IF NOT EXISTS keel_action_proof_objects (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id),
 proof_id UUID NOT NULL,
 actor_key_id TEXT NOT NULL,
 actor_principal_id UUID NOT NULL,
 envelope_id UUID NOT NULL,
 action TEXT NOT NULL,
 resource_id TEXT,
 request_fingerprint CHAR(64) NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 authority_fingerprint CHAR(64) NOT NULL CHECK(authority_fingerprint ~ '^[a-f0-9]{64}$'),
 decision TEXT NOT NULL CHECK(decision IN ('PERMIT','DENY','REQUIRE_APPROVAL')),
 reason_codes JSONB NOT NULL CHECK(jsonb_typeof(reason_codes)='array'),
 execution_ref TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,proof_id),
 FOREIGN KEY(tenant_id,envelope_id) REFERENCES keel_authority_envelopes(tenant_id,envelope_id),
 FOREIGN KEY(tenant_id,actor_principal_id) REFERENCES keel_principals(tenant_id,principal_id)
);
CREATE INDEX IF NOT EXISTS keel_action_proof_objects_request_idx ON keel_action_proof_objects(tenant_id,request_fingerprint,created_at DESC);
CREATE TABLE IF NOT EXISTS keel_authority_action_approvals (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id),
 approval_id UUID NOT NULL,
 envelope_id UUID NOT NULL,
 request_fingerprint CHAR(64) NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 approver_principal_id UUID NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('approve','reject')),
 rationale TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,approval_id),
 UNIQUE(tenant_id,envelope_id,request_fingerprint,approver_principal_id),
 FOREIGN KEY(tenant_id,envelope_id) REFERENCES keel_authority_envelopes(tenant_id,envelope_id),
 FOREIGN KEY(tenant_id,approver_principal_id) REFERENCES keel_principals(tenant_id,principal_id)
);
DO $keel$
DECLARE t TEXT;
BEGIN
 FOREACH t IN ARRAY ARRAY['keel_authority_envelopes','keel_action_proof_objects','keel_authority_action_approvals'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',t||'_tenant_isolation',t);
  EXECUTE format('CREATE POLICY %I ON public.%I USING (tenant_id=NULLIF(current_setting(''keel.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=NULLIF(current_setting(''keel.tenant_id'',true),'''')::uuid)',t||'_tenant_isolation',t);
 END LOOP;
END
$keel$;

-- Action proofs and approvals are append-only evidence.
CREATE OR REPLACE FUNCTION public.keel_reject_kAAA_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $function$
BEGIN
 RAISE EXCEPTION 'keel_kAAA_evidence_is_immutable' USING ERRCODE='55000';
END
$function$;
DROP TRIGGER IF EXISTS keel_action_proof_objects_immutable ON public.keel_action_proof_objects;
CREATE TRIGGER keel_action_proof_objects_immutable BEFORE UPDATE OR DELETE ON public.keel_action_proof_objects FOR EACH ROW EXECUTE FUNCTION public.keel_reject_kAAA_evidence_mutation();
DROP TRIGGER IF EXISTS keel_authority_action_approvals_immutable ON public.keel_authority_action_approvals;
CREATE TRIGGER keel_authority_action_approvals_immutable BEFORE UPDATE OR DELETE ON public.keel_authority_action_approvals FOR EACH ROW EXECUTE FUNCTION public.keel_reject_kAAA_evidence_mutation();
