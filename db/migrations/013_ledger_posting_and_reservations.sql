-- Keel ledger posting, projections, reservations, hash-linked evidence and tenant isolation.
-- Requires migration 012. Apply only through a reviewed migration runner after disposable-PostgreSQL tests.
-- Never apply automatically at application startup.

ALTER TABLE keel_ledger_accounts
  ADD COLUMN IF NOT EXISTS allow_negative_balance BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_reservable BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='keel_ledger_account_normal_side_class_check') THEN
    ALTER TABLE keel_ledger_accounts ADD CONSTRAINT keel_ledger_account_normal_side_class_check
      CHECK (account_class='memorandum'
        OR (account_class IN ('asset','expense') AND normal_side='debit')
        OR (account_class IN ('liability','equity','income') AND normal_side='credit'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS keel_ledger_account_balances (
  tenant_id UUID NOT NULL,
  account_id TEXT NOT NULL,
  currency CHAR(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  debit_total NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK(debit_total>=0 AND debit_total=trunc(debit_total)),
  credit_total NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK(credit_total>=0 AND credit_total=trunc(credit_total)),
  normal_balance_minor NUMERIC(79,0) NOT NULL DEFAULT 0 CHECK(normal_balance_minor=trunc(normal_balance_minor)),
  version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(tenant_id,account_id),
  FOREIGN KEY(tenant_id,account_id) REFERENCES keel_ledger_accounts(tenant_id,account_id)
);
CREATE INDEX IF NOT EXISTS keel_ledger_balances_currency_idx
  ON keel_ledger_account_balances(tenant_id,currency,account_id);

CREATE OR REPLACE FUNCTION keel_ledger_balance_currency_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_currency CHAR(3);
BEGIN
  SELECT currency INTO account_currency FROM keel_ledger_accounts
   WHERE tenant_id=NEW.tenant_id AND account_id=NEW.account_id;
  IF account_currency IS NULL OR account_currency<>NEW.currency THEN
    RAISE EXCEPTION 'ledger balance currency must match account currency';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS keel_ledger_balance_currency_guard_trigger ON keel_ledger_account_balances;
CREATE TRIGGER keel_ledger_balance_currency_guard_trigger
  BEFORE INSERT OR UPDATE ON keel_ledger_account_balances
  FOR EACH ROW EXECUTE FUNCTION keel_ledger_balance_currency_guard();

-- Seed rebuildable projections only from posted journal facts.
WITH totals AS (
  SELECT l.tenant_id,l.account_id,
    COALESCE(SUM(l.amount_minor) FILTER(WHERE l.side='debit'),0) AS debit_total,
    COALESCE(SUM(l.amount_minor) FILTER(WHERE l.side='credit'),0) AS credit_total
  FROM keel_ledger_lines l
  JOIN keel_ledger_journals j ON j.tenant_id=l.tenant_id AND j.journal_id=l.journal_id
  WHERE j.status='posted'
  GROUP BY l.tenant_id,l.account_id
)
INSERT INTO keel_ledger_account_balances
  (tenant_id,account_id,currency,debit_total,credit_total,normal_balance_minor,version)
SELECT a.tenant_id,a.account_id,a.currency,
  COALESCE(t.debit_total,0),COALESCE(t.credit_total,0),
  CASE WHEN a.normal_side='debit'
    THEN COALESCE(t.debit_total,0)-COALESCE(t.credit_total,0)
    ELSE COALESCE(t.credit_total,0)-COALESCE(t.debit_total,0) END,
  1
FROM keel_ledger_accounts a
LEFT JOIN totals t ON t.tenant_id=a.tenant_id AND t.account_id=a.account_id
ON CONFLICT(tenant_id,account_id) DO NOTHING;

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
  ON keel_ledger_reservations(tenant_id,account_id,expires_at) WHERE status='active';
CREATE INDEX IF NOT EXISTS keel_ledger_reservations_expiry_idx
  ON keel_ledger_reservations(expires_at) WHERE status='active' AND expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION keel_ledger_reservation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_currency CHAR(3);
BEGIN
  SELECT currency INTO account_currency FROM keel_ledger_accounts
   WHERE tenant_id=NEW.tenant_id AND account_id=NEW.account_id;
  IF account_currency IS NULL OR account_currency<>NEW.currency THEN
    RAISE EXCEPTION 'reservation currency must match account currency';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.tenant_id,NEW.reservation_id,NEW.idempotency_key,NEW.account_id,NEW.currency,NEW.amount_minor,NEW.purpose,NEW.created_at)
       IS DISTINCT FROM
       (OLD.tenant_id,OLD.reservation_id,OLD.idempotency_key,OLD.account_id,OLD.currency,OLD.amount_minor,OLD.purpose,OLD.created_at) THEN
      RAISE EXCEPTION 'reservation identity and amount are immutable';
    END IF;
    IF OLD.status<>'active' OR NEW.status NOT IN ('released','consumed','expired') THEN
      RAISE EXCEPTION 'reservation state transition is invalid';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS keel_ledger_reservation_guard_trigger ON keel_ledger_reservations;
CREATE TRIGGER keel_ledger_reservation_guard_trigger
  BEFORE INSERT OR UPDATE ON keel_ledger_reservations
  FOR EACH ROW EXECUTE FUNCTION keel_ledger_reservation_guard();

-- A per-tenant sequence head serialises event appends and detects deletion/reordering.
CREATE TABLE IF NOT EXISTS keel_ledger_event_heads (
  tenant_id UUID PRIMARY KEY REFERENCES keel_tenants(tenant_id),
  last_sequence BIGINT NOT NULL DEFAULT 0 CHECK(last_sequence>=0),
  last_fingerprint CHAR(64),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK((last_sequence=0 AND last_fingerprint IS NULL)
    OR (last_sequence>0 AND last_fingerprint ~ '^[0-9a-f]{64}$'))
);
CREATE TABLE IF NOT EXISTS keel_ledger_events (
  tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id),
  event_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'ACCOUNT_CREATED','JOURNAL_POSTED','RESERVATION_CREATED',
    'RESERVATION_RELEASED','RESERVATION_CONSUMED','PROJECTION_REBUILT'
  )),
  subject_id TEXT NOT NULL,
  tenant_sequence BIGINT NOT NULL CHECK(tenant_sequence>0),
  previous_event_fingerprint CHAR(64),
  event_fingerprint CHAR(64) NOT NULL CHECK(event_fingerprint ~ '^[0-9a-f]{64}$'),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(tenant_id,event_id),
  UNIQUE(tenant_id,tenant_sequence),
  UNIQUE(tenant_id,event_fingerprint),
  CHECK(previous_event_fingerprint IS NULL OR previous_event_fingerprint ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS keel_ledger_events_subject_idx
  ON keel_ledger_events(tenant_id,subject_id,tenant_sequence DESC);
CREATE OR REPLACE FUNCTION keel_ledger_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Keel ledger events are append-only';
END; $$;
DROP TRIGGER IF EXISTS keel_ledger_events_no_mutation ON keel_ledger_events;
CREATE TRIGGER keel_ledger_events_no_mutation
  BEFORE UPDATE OR DELETE ON keel_ledger_events
  FOR EACH ROW EXECUTE FUNCTION keel_ledger_events_immutable();

-- Tenant isolation is defence in depth. Runtime role must not own these tables and must not have BYPASSRLS.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'keel_ledger_accounts','keel_ledger_journals','keel_ledger_lines',
    'keel_ledger_account_balances','keel_ledger_reservations',
    'keel_ledger_event_heads','keel_ledger_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I',t||'_tenant_isolation',t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = NULLIF(current_setting(''keel.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''keel.tenant_id'',true),'''')::uuid)',
      t||'_tenant_isolation',t
    );
  END LOOP;
END $$;
