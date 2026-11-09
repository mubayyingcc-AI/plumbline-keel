-- Keel ledger operational state: derived balances, bounded reservations and tenant RLS.
-- Migration 012 establishes immutable journal facts. This migration adds rebuildable projections
-- and reservation state. Apply only through the reviewed migration runner after PostgreSQL tests.

ALTER TABLE keel_ledger_accounts
  ADD COLUMN IF NOT EXISTS allow_negative_balance BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_reservable BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS keel_ledger_account_balances (
  tenant_id UUID NOT NULL,
  account_id TEXT NOT NULL,
  currency CHAR(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  debit_total NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK(debit_total >= 0 AND debit_total=trunc(debit_total)),
  credit_total NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK(credit_total >= 0 AND credit_total=trunc(credit_total)),
  normal_balance_minor NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK(normal_balance_minor=trunc(normal_balance_minor)),
  version BIGINT NOT NULL DEFAULT 0 CHECK(version >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(tenant_id,account_id),
  FOREIGN KEY(tenant_id,account_id) REFERENCES keel_ledger_accounts(tenant_id,account_id),
  CHECK(currency ~ '^[A-Z]{3}$')
);
CREATE INDEX IF NOT EXISTS keel_ledger_balances_currency_idx
  ON keel_ledger_account_balances(tenant_id,currency,account_id);

CREATE TABLE IF NOT EXISTS keel_ledger_reservations (
  tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id),
  reservation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  account_id TEXT NOT NULL,
  currency CHAR(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  amount_minor NUMERIC(78,0) NOT NULL CHECK(amount_minor>0 AND amount_minor=trunc(amount_minor)),
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','released','consumed','expired')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  close_reason TEXT,
  PRIMARY KEY(tenant_id,reservation_id),
  UNIQUE(tenant_id,idempotency_key),
  FOREIGN KEY(tenant_id,account_id) REFERENCES keel_ledger_accounts(tenant_id,account_id),
  CHECK((status='active' AND closed_at IS NULL) OR (status<>'active' AND closed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS keel_ledger_reservations_active_idx
  ON keel_ledger_reservations(tenant_id,account_id,expires_at)
  WHERE status='active';

CREATE TABLE IF NOT EXISTS keel_ledger_events (
  tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id),
  event_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'ACCOUNT_CREATED','JOURNAL_POSTED','RESERVATION_CREATED',
    'RESERVATION_RELEASED','RESERVATION_CONSUMED','PROJECTION_REBUILT'
  )),
  subject_id TEXT NOT NULL,
  event_fingerprint CHAR(64) NOT NULL CHECK(event_fingerprint ~ '^[0-9a-f]{64}$'),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(tenant_id,event_id)
);
CREATE INDEX IF NOT EXISTS keel_ledger_events_subject_idx
  ON keel_ledger_events(tenant_id,subject_id,created_at DESC);
CREATE OR REPLACE FUNCTION keel_ledger_events_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Keel ledger events are append-only';
END; $$;
DROP TRIGGER IF EXISTS keel_ledger_events_no_mutation ON keel_ledger_events;
CREATE TRIGGER keel_ledger_events_no_mutation
  BEFORE UPDATE OR DELETE ON keel_ledger_events
  FOR EACH ROW EXECUTE FUNCTION keel_ledger_events_immutable();

-- Rebuild initial projections from posted journal facts; these rows remain derived/cache state.
INSERT INTO keel_ledger_account_balances
  (tenant_id,account_id,currency,debit_total,credit_total,normal_balance_minor,version)
SELECT a.tenant_id,a.account_id,a.currency,
       COALESCE(SUM(p.amount_minor) FILTER(WHERE p.side='debit'),0),
       COALESCE(SUM(p.amount_minor) FILTER(WHERE p.side='credit'),0),
       CASE WHEN a.normal_side='debit'
            THEN COALESCE(SUM(p.amount_minor) FILTER(WHERE p.side='debit'),0)-COALESCE(SUM(p.amount_minor) FILTER(WHERE p.side='credit'),0)
            ELSE COALESCE(SUM(p.amount_minor) FILTER(WHERE p.side='credit'),0)-COALESCE(SUM(p.amount_minor) FILTER(WHERE p.side='debit'),0)
       END,1
FROM keel_ledger_accounts a
LEFT JOIN (
  SELECT l.tenant_id,l.account_id,l.side,l.amount_minor
  FROM keel_ledger_lines l
  JOIN keel_ledger_journals j ON j.tenant_id=l.tenant_id AND j.journal_id=l.journal_id
  WHERE j.status='posted'
) p ON p.tenant_id=a.tenant_id AND p.account_id=a.account_id
GROUP BY a.tenant_id,a.account_id,a.currency,a.normal_side
ON CONFLICT(tenant_id,account_id) DO NOTHING;

-- The API sets this transaction-local tenant context after authenticating its tenant key.
-- RLS is defence in depth; all application SQL must still include explicit tenant predicates.
DO $keel$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'keel_ledger_accounts','keel_ledger_journals','keel_ledger_lines',
    'keel_ledger_account_balances','keel_ledger_reservations','keel_ledger_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I',t||'_tenant_isolation',t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = NULLIF(current_setting(''keel.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''keel.tenant_id'',true),'''')::uuid)',
      t||'_tenant_isolation',t
    );
  END LOOP;
END
$keel$;
