-- Accounting books and effective-dated accounting periods.
-- Journal period binding is optional for legacy rows but mandatory on the public ledger API.
-- Every period-bound journal must belong to an open period and fall inside its date range.

CREATE TABLE IF NOT EXISTS keel_accounting_books (
  tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id),
  book_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  book_code TEXT NOT NULL,
  book_name TEXT NOT NULL,
  functional_currency CHAR(3) NOT NULL CHECK(functional_currency ~ '^[A-Z]{3}$'),
  accounting_basis TEXT NOT NULL CHECK(accounting_basis IN ('IFRS','LOCAL_GAAP','IPSAS','INTERNAL')),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(tenant_id,book_id),
  UNIQUE(tenant_id,entity_id,book_code)
);

CREATE TABLE IF NOT EXISTS keel_accounting_book_accounts (
  tenant_id UUID NOT NULL,
  book_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  mapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(tenant_id,book_id,account_id),
  FOREIGN KEY(tenant_id,book_id) REFERENCES keel_accounting_books(tenant_id,book_id),
  FOREIGN KEY(tenant_id,account_id) REFERENCES keel_ledger_accounts(tenant_id,account_id)
);
CREATE INDEX IF NOT EXISTS keel_accounting_book_accounts_account_idx
  ON keel_accounting_book_accounts(tenant_id,account_id,book_id);

CREATE TABLE IF NOT EXISTS keel_accounting_periods (
  tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id),
  period_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  period_code TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','open','soft_closed','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  closed_by TEXT,
  close_hash CHAR(64),
  version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0),
  PRIMARY KEY(tenant_id,period_id),
  UNIQUE(tenant_id,book_id,period_code),
  UNIQUE(tenant_id,book_id,period_id),
  FOREIGN KEY(tenant_id,book_id) REFERENCES keel_accounting_books(tenant_id,book_id),
  CHECK(period_start<=period_end),
  CHECK(
    (status='closed' AND closed_at IS NOT NULL AND closed_by IS NOT NULL AND close_hash IS NOT NULL)
    OR
    (status<>'closed' AND closed_at IS NULL AND closed_by IS NULL AND close_hash IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS keel_accounting_periods_book_dates_idx
  ON keel_accounting_periods(tenant_id,book_id,period_start,period_end);

ALTER TABLE keel_ledger_journals
  ADD COLUMN IF NOT EXISTS book_id TEXT,
  ADD COLUMN IF NOT EXISTS period_id TEXT,
  ADD COLUMN IF NOT EXISTS accounting_date DATE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='keel_ledger_journals_period_fk') THEN
    ALTER TABLE keel_ledger_journals
      ADD CONSTRAINT keel_ledger_journals_period_fk
      FOREIGN KEY(tenant_id,book_id,period_id)
      REFERENCES keel_accounting_periods(tenant_id,book_id,period_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='keel_ledger_journals_period_binding_check') THEN
    ALTER TABLE keel_ledger_journals
      ADD CONSTRAINT keel_ledger_journals_period_binding_check
      CHECK (
        (book_id IS NULL AND period_id IS NULL AND accounting_date IS NULL)
        OR
        (book_id IS NOT NULL AND period_id IS NOT NULL AND accounting_date IS NOT NULL)
      );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS keel_ledger_journals_book_period_idx
  ON keel_ledger_journals(tenant_id,book_id,period_id,accounting_date)
  WHERE period_id IS NOT NULL;

CREATE OR REPLACE FUNCTION keel_accounting_period_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.tenant_id,NEW.period_id,NEW.book_id,NEW.period_code,NEW.period_start,NEW.period_end)
     IS DISTINCT FROM
     (OLD.tenant_id,OLD.period_id,OLD.book_id,OLD.period_code,OLD.period_start,OLD.period_end) THEN
    RAISE EXCEPTION 'accounting period identity and date range are immutable';
  END IF;
  IF OLD.status='closed' THEN
    RAISE EXCEPTION 'closed accounting period is immutable';
  END IF;
  IF NEW.status='closed' THEN
    RAISE EXCEPTION 'period close is disabled until dual-control close approval is implemented';
  END IF;
  IF NEW.status<>OLD.status AND NOT (
    (OLD.status='planned' AND NEW.status='open')
    OR (OLD.status='open' AND NEW.status='soft_closed')
  ) THEN
    RAISE EXCEPTION 'accounting period state transition is not permitted';
  END IF;
  IF NEW.status='open' AND NEW.opened_at IS NULL THEN
    NEW.opened_at:=NOW();
  END IF;
  NEW.version:=OLD.version+1;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS keel_accounting_period_transition_guard_trigger ON keel_accounting_periods;
CREATE TRIGGER keel_accounting_period_transition_guard_trigger
  BEFORE UPDATE ON keel_accounting_periods
  FOR EACH ROW EXECUTE FUNCTION keel_accounting_period_transition_guard();

CREATE OR REPLACE FUNCTION keel_ledger_journal_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p keel_accounting_periods%ROWTYPE;
BEGIN
  IF NEW.period_id IS NULL THEN
    IF NEW.book_id IS NOT NULL OR NEW.accounting_date IS NOT NULL THEN
      RAISE EXCEPTION 'book, period and accounting date must be bound together';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO p FROM keel_accounting_periods
   WHERE tenant_id=NEW.tenant_id AND book_id=NEW.book_id AND period_id=NEW.period_id
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'accounting period not found for journal book'; END IF;
  IF p.status<>'open' THEN RAISE EXCEPTION 'ledger posting requires an open accounting period'; END IF;
  IF NEW.accounting_date<p.period_start OR NEW.accounting_date>p.period_end THEN
    RAISE EXCEPTION 'journal accounting date falls outside the bound accounting period';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS keel_ledger_journal_period_guard_trigger ON keel_ledger_journals;
CREATE TRIGGER keel_ledger_journal_period_guard_trigger
  BEFORE INSERT OR UPDATE OF book_id,period_id,accounting_date ON keel_ledger_journals
  FOR EACH ROW EXECUTE FUNCTION keel_ledger_journal_period_guard();

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['keel_accounting_books','keel_accounting_book_accounts','keel_accounting_periods'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS keel_tenant_isolation ON %I',t);
    EXECUTE format(
      'CREATE POLICY keel_tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''keel.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''keel.tenant_id'',true),'''')::uuid)',
      t
    );
  END LOOP;
END $$;
