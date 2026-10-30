-- Plumbline Keel tenant isolation and credential registry v1
CREATE TABLE IF NOT EXISTS keel_tenants (
  tenant_id UUID PRIMARY KEY,
  tenant_name TEXT NOT NULL,
  tenant_slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS keel_tenant_keys (
  key_id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id),
  token_hash CHAR(64) NOT NULL UNIQUE,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS keel_tenant_keys_tenant_idx ON keel_tenant_keys(tenant_id,status);
ALTER TABLE keel_model_census ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES keel_tenants(tenant_id);
ALTER TABLE keel_proof_dockets ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES keel_tenants(tenant_id);
ALTER TABLE keel_assurance_events ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES keel_tenants(tenant_id);
CREATE INDEX IF NOT EXISTS keel_model_census_tenant_idx ON keel_model_census(tenant_id,model_id);
CREATE INDEX IF NOT EXISTS keel_proof_dockets_tenant_idx ON keel_proof_dockets(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS keel_assurance_events_tenant_idx ON keel_assurance_events(tenant_id,created_at DESC);
