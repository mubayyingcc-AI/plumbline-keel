-- Durable provider instruction and event lifecycle.
-- Outbox insertion must share the transaction that posts the originating ledger journal.
-- Inbox events are evidence only; they never post or reverse ledger entries automatically.

CREATE TABLE IF NOT EXISTS keel_provider_outbox (
  tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id),
  outbox_id UUID NOT NULL,
  journal_id TEXT NOT NULL,
  provider_id TEXT NOT NULL CHECK(length(provider_id) BETWEEN 1 AND 120),
  aggregate_type TEXT NOT NULL CHECK(length(aggregate_type) BETWEEN 1 AND 80),
  aggregate_id TEXT NOT NULL CHECK(length(aggregate_id) BETWEEN 1 AND 160),
  instruction_type TEXT NOT NULL CHECK(length(instruction_type) BETWEEN 1 AND 100),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),
  payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
  payload_fingerprint CHAR(64) NOT NULL CHECK(payload_fingerprint ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','leased','accepted','unknown','failed','reconciled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  max_attempts INTEGER NOT NULL DEFAULT 8 CHECK(max_attempts BETWEEN 1 AND 32),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_owner TEXT,
  lease_until TIMESTAMPTZ,
  provider_instruction_id TEXT,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(tenant_id,outbox_id),
  UNIQUE(tenant_id,provider_id,idempotency_key),
  FOREIGN KEY(tenant_id,journal_id) REFERENCES keel_ledger_journals(tenant_id,journal_id),
  CHECK((status='leased' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL)
     OR (status<>'leased' AND lease_owner IS NULL AND lease_until IS NULL))
);
CREATE INDEX IF NOT EXISTS keel_provider_outbox_claim_idx
  ON keel_provider_outbox(tenant_id,status,available_at,created_at);

CREATE TABLE IF NOT EXISTS keel_provider_inbox (
  tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id),
  inbox_id UUID NOT NULL,
  provider_id TEXT NOT NULL CHECK(length(provider_id) BETWEEN 1 AND 120),
  provider_event_id TEXT NOT NULL CHECK(length(provider_event_id) BETWEEN 1 AND 200),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),
  event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 100),
  event_status TEXT NOT NULL CHECK(event_status IN ('accepted','pending','cleared','settled','reversed','failed','unknown')),
  payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
  payload_fingerprint CHAR(64) NOT NULL CHECK(payload_fingerprint ~ '^[a-f0-9]{64}$'),
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_key_id TEXT,
  verified_at TIMESTAMPTZ,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK(processing_status IN ('received','processed','quarantined')),
  PRIMARY KEY(tenant_id,inbox_id),
  UNIQUE(tenant_id,provider_id,provider_event_id),
  CHECK((signature_verified=FALSE AND verification_key_id IS NULL AND verified_at IS NULL)
     OR (signature_verified=TRUE AND verification_key_id IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS keel_provider_inbox_processing_idx
  ON keel_provider_inbox(tenant_id,processing_status,received_at);

CREATE TABLE IF NOT EXISTS keel_provider_reconciliation_cases (
  tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id),
  case_id UUID NOT NULL,
  outbox_id UUID,
  inbox_id UUID,
  status TEXT NOT NULL CHECK(status IN ('pending','matched','exception','quarantined')),
  reason_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  expected_fingerprint CHAR(64),
  observed_fingerprint CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolution_ref TEXT,
  PRIMARY KEY(tenant_id,case_id),
  FOREIGN KEY(tenant_id,outbox_id) REFERENCES keel_provider_outbox(tenant_id,outbox_id),
  FOREIGN KEY(tenant_id,inbox_id) REFERENCES keel_provider_inbox(tenant_id,inbox_id),
  CHECK(outbox_id IS NOT NULL OR inbox_id IS NOT NULL),
  CHECK((status IN ('pending','exception','quarantined') AND resolved_at IS NULL)
     OR (status='matched' AND resolved_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS keel_provider_reconciliation_inbox_once_idx
  ON keel_provider_reconciliation_cases(tenant_id,inbox_id) WHERE inbox_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS keel_provider_reconciliation_open_idx
  ON keel_provider_reconciliation_cases(tenant_id,status,created_at);

DO $keel$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'keel_provider_outbox','keel_provider_inbox','keel_provider_reconciliation_cases'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',t||'_tenant_isolation',t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I USING (tenant_id = NULLIF(current_setting(''keel.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''keel.tenant_id'',true),'''')::uuid)',
      t||'_tenant_isolation',t
    );
  END LOOP;
END
$keel$;
