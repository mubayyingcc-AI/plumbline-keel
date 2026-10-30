-- Plumbline Keel Assurance Fabric schema v1
-- Advisory evidence records only. No customer financial transactions are executed.
CREATE TABLE IF NOT EXISTS keel_model_census (
  model_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  version TEXT NOT NULL,
  owner_ref TEXT NOT NULL,
  purpose TEXT NOT NULL,
  access_scope TEXT NOT NULL,
  external BOOLEAN NOT NULL DEFAULT FALSE,
  model_fingerprint CHAR(64) NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS keel_proof_dockets (
  docket_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decision_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('ALLOW','HOLD','REVIEW')),
  docket_fingerprint CHAR(64) NOT NULL UNIQUE,
  decision_fingerprint CHAR(64) NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS keel_proof_dockets_created_idx ON keel_proof_dockets(created_at DESC);
CREATE TABLE IF NOT EXISTS keel_assurance_events (
  event_id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type TEXT NOT NULL CHECK (event_type IN ('MODEL_REGISTERED','DOCKET_CREATED','DRIFT_DETECTED','FALLBACK_RESTRICTED','WITNESS_RECORDED')),
  subject_id TEXT NOT NULL,
  event_fingerprint CHAR(64) NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS keel_assurance_events_subject_idx ON keel_assurance_events(subject_id,created_at DESC);
