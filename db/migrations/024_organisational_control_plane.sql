-- Organisational Control Plane v1. Reuses Keel tenant, principal and authority foundations.
-- No connector credentials or external actions are stored or executed.
CREATE TABLE IF NOT EXISTS public.keel_integration_capabilities (
 tenant_id UUID NOT NULL REFERENCES public.keel_tenants(tenant_id), capability_id UUID NOT NULL,
 integration_id TEXT NOT NULL CHECK(integration_id ~ '^[a-z][a-z0-9][a-z0-9._:-]{0,118}$'),
 provider_id TEXT NOT NULL CHECK(provider_id ~ '^[a-z][a-z0-9][a-z0-9._:-]{0,118}$'),
 principal_id UUID NOT NULL, display_name TEXT NOT NULL, integration_version TEXT NOT NULL,
 manifest JSONB NOT NULL CHECK(jsonb_typeof(manifest)='object'),
 manifest_fingerprint CHAR(64) NOT NULL CHECK(manifest_fingerprint ~ '^[a-f0-9]{64}$'),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','revoked')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), revoked_at TIMESTAMPTZ,
 PRIMARY KEY(tenant_id,capability_id), UNIQUE(tenant_id,integration_id,manifest_fingerprint),
 FOREIGN KEY(tenant_id,principal_id) REFERENCES public.keel_principals(tenant_id,principal_id)
);
CREATE INDEX IF NOT EXISTS keel_integration_capabilities_principal_idx ON public.keel_integration_capabilities(tenant_id,principal_id,status);
CREATE INDEX IF NOT EXISTS keel_integration_capabilities_integration_idx ON public.keel_integration_capabilities(tenant_id,integration_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.keel_control_action_requests (
 tenant_id UUID NOT NULL REFERENCES public.keel_tenants(tenant_id), request_id UUID NOT NULL,
 capability_id UUID NOT NULL, principal_id UUID NOT NULL, envelope_id UUID NOT NULL,
 operation TEXT NOT NULL, resource_id TEXT NOT NULL, resource_type TEXT NOT NULL,
 payload_fingerprint CHAR(64) NOT NULL CHECK(payload_fingerprint ~ '^[a-f0-9]{64}$'),
 request_fingerprint CHAR(64) NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 decision TEXT NOT NULL CHECK(decision IN ('PERMIT','REQUIRE_APPROVAL','DENY')),
 status TEXT NOT NULL CHECK(status IN ('awaiting_approval','authorized','denied','cancelled')),
 proof_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,request_id), UNIQUE(tenant_id,request_fingerprint),
 FOREIGN KEY(tenant_id,capability_id) REFERENCES public.keel_integration_capabilities(tenant_id,capability_id),
 FOREIGN KEY(tenant_id,principal_id) REFERENCES public.keel_principals(tenant_id,principal_id),
 FOREIGN KEY(tenant_id,envelope_id) REFERENCES public.keel_authority_envelopes(tenant_id,envelope_id),
 FOREIGN KEY(tenant_id,proof_id) REFERENCES public.keel_action_proof_objects(tenant_id,proof_id)
);
CREATE INDEX IF NOT EXISTS keel_control_action_requests_history_idx ON public.keel_control_action_requests(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS keel_control_action_requests_status_idx ON public.keel_control_action_requests(tenant_id,status,created_at);
CREATE TABLE IF NOT EXISTS public.keel_control_action_events (
 tenant_id UUID NOT NULL REFERENCES public.keel_tenants(tenant_id), event_id UUID NOT NULL, request_id UUID NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('CAPABILITY_REGISTERED','CAPABILITY_REVOKED','ACTION_HELD_FOR_APPROVAL','ACTION_AUTHORIZED','ACTION_DENIED')),
 event_fingerprint CHAR(64) NOT NULL CHECK(event_fingerprint ~ '^[a-f0-9]{64}$'),
 payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,event_id), FOREIGN KEY(tenant_id,request_id) REFERENCES public.keel_control_action_requests(tenant_id,request_id)
);
CREATE INDEX IF NOT EXISTS keel_control_action_events_request_idx ON public.keel_control_action_events(tenant_id,request_id,created_at);
DO $keel$
DECLARE t TEXT;
BEGIN
 FOREACH t IN ARRAY ARRAY['keel_integration_capabilities','keel_control_action_requests','keel_control_action_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',t||'_tenant_isolation',t);
  EXECUTE format('CREATE POLICY %I ON public.%I USING (tenant_id=NULLIF(current_setting(''keel.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=NULLIF(current_setting(''keel.tenant_id'',true),'''')::uuid)',t||'_tenant_isolation',t);
 END LOOP;
END
$keel$;
CREATE OR REPLACE FUNCTION public.keel_reject_control_event_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $function$
BEGIN RAISE EXCEPTION 'keel_control_action_events_are_immutable' USING ERRCODE='55000'; END
$function$;
DROP TRIGGER IF EXISTS keel_control_action_events_immutable ON public.keel_control_action_events;
CREATE TRIGGER keel_control_action_events_immutable BEFORE UPDATE OR DELETE ON public.keel_control_action_events FOR EACH ROW EXECUTE FUNCTION public.keel_reject_control_event_mutation();
