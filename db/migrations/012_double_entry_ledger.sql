-- Keel double-entry ledger foundation. Apply only through a reviewed migration runner.
-- Posted journals are immutable; corrections use compensating journals.
CREATE TABLE IF NOT EXISTS keel_ledger_accounts (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id),
 account_id TEXT NOT NULL,
 account_code TEXT NOT NULL,
 account_name TEXT NOT NULL,
 account_class TEXT NOT NULL CHECK(account_class IN ('asset','liability','equity','income','expense','memorandum')),
 currency CHAR(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 normal_side TEXT NOT NULL CHECK(normal_side IN ('debit','credit')),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','closed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,account_id),
 UNIQUE(tenant_id,account_code,currency)
);
CREATE INDEX IF NOT EXISTS keel_ledger_accounts_lookup_idx ON keel_ledger_accounts(tenant_id,currency,status);
CREATE TABLE IF NOT EXISTS keel_ledger_journals (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id),
 journal_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 description TEXT NOT NULL,
 source_ref TEXT NOT NULL,
 effective_at TIMESTAMPTZ NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted')),
 fingerprint CHAR(64),
 reversal_of_journal_id TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 posted_at TIMESTAMPTZ,
 PRIMARY KEY(tenant_id,journal_id),
 UNIQUE(tenant_id,idempotency_key),
 FOREIGN KEY(tenant_id,reversal_of_journal_id) REFERENCES keel_ledger_journals(tenant_id,journal_id),
 CHECK(reversal_of_journal_id IS NULL OR reversal_of_journal_id<>journal_id),
 CHECK((status='draft' AND posted_at IS NULL) OR (status='posted' AND posted_at IS NOT NULL AND fingerprint IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS keel_ledger_journals_effective_idx ON keel_ledger_journals(tenant_id,effective_at DESC);
CREATE TABLE IF NOT EXISTS keel_ledger_lines (
 tenant_id UUID NOT NULL,
 journal_id TEXT NOT NULL,
 line_number INTEGER NOT NULL CHECK(line_number>0),
 account_id TEXT NOT NULL,
 side TEXT NOT NULL CHECK(side IN ('debit','credit')),
 currency CHAR(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 amount_minor NUMERIC(78,0) NOT NULL CHECK(amount_minor>0 AND amount_minor=trunc(amount_minor)),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,journal_id,line_number),
 FOREIGN KEY(tenant_id,journal_id) REFERENCES keel_ledger_journals(tenant_id,journal_id),
 FOREIGN KEY(tenant_id,account_id) REFERENCES keel_ledger_accounts(tenant_id,account_id)
);
CREATE INDEX IF NOT EXISTS keel_ledger_lines_account_idx ON keel_ledger_lines(tenant_id,account_id,currency,journal_id);

CREATE OR REPLACE FUNCTION keel_ledger_reject_posted_mutation() RETURNS trigger LANGUAGE plpgsql AS $
DECLARE v_status TEXT;
BEGIN
 IF TG_OP IN ('UPDATE','DELETE') THEN
  SELECT status INTO v_status FROM keel_ledger_journals WHERE tenant_id=OLD.tenant_id AND journal_id=OLD.journal_id;
  IF v_status='posted' THEN RAISE EXCEPTION 'posted ledger journal is immutable'; END IF;
 END IF;
 IF TG_OP IN ('INSERT','UPDATE') THEN
  SELECT status INTO v_status FROM keel_ledger_journals WHERE tenant_id=NEW.tenant_id AND journal_id=NEW.journal_id;
  IF v_status='posted' THEN RAISE EXCEPTION 'posted ledger journal is immutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $;
DROP TRIGGER IF EXISTS keel_ledger_lines_immutable ON keel_ledger_lines;
CREATE TRIGGER keel_ledger_lines_immutable BEFORE INSERT OR UPDATE OR DELETE ON keel_ledger_lines
FOR EACH ROW EXECUTE FUNCTION keel_ledger_reject_posted_mutation();

CREATE OR REPLACE FUNCTION keel_ledger_reject_posted_header_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='posted' THEN RAISE EXCEPTION 'posted ledger journal is immutable'; END IF;
 IF NEW.tenant_id<>OLD.tenant_id OR NEW.journal_id<>OLD.journal_id OR NEW.idempotency_key<>OLD.idempotency_key THEN
  RAISE EXCEPTION 'ledger journal identity is immutable';
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS keel_ledger_journals_immutable ON keel_ledger_journals;
CREATE TRIGGER keel_ledger_journals_immutable BEFORE UPDATE OR DELETE ON keel_ledger_journals
FOR EACH ROW EXECUTE FUNCTION keel_ledger_reject_posted_header_mutation();

CREATE OR REPLACE FUNCTION keel_ledger_assert_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_tenant UUID; v_journal TEXT; v_status TEXT; v_count INTEGER; v_bad INTEGER;
BEGIN
 v_tenant := COALESCE(NEW.tenant_id,OLD.tenant_id);
 v_journal := COALESCE(NEW.journal_id,OLD.journal_id);
 SELECT status INTO v_status FROM keel_ledger_journals WHERE tenant_id=v_tenant AND journal_id=v_journal;
 IF v_status='posted' THEN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE debit_total<>credit_total OR debit_total=0)
  INTO v_count,v_bad FROM (
   SELECT currency,
    COALESCE(SUM(amount_minor) FILTER (WHERE side='debit'),0) AS debit_total,
    COALESCE(SUM(amount_minor) FILTER (WHERE side='credit'),0) AS credit_total
   FROM keel_ledger_lines WHERE tenant_id=v_tenant AND journal_id=v_journal GROUP BY currency
  ) totals;
  IF v_count=0 OR v_bad>0 THEN RAISE EXCEPTION 'ledger journal must balance independently in every currency'; END IF;
  IF (SELECT COUNT(*) FROM keel_ledger_lines WHERE tenant_id=v_tenant AND journal_id=v_journal)<2 THEN
   RAISE EXCEPTION 'ledger journal requires at least two lines';
  END IF;
 END IF;
 RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS keel_ledger_balance_header_check ON keel_ledger_journals;
CREATE CONSTRAINT TRIGGER keel_ledger_balance_header_check
AFTER INSERT OR UPDATE ON keel_ledger_journals DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION keel_ledger_assert_balanced();
DROP TRIGGER IF EXISTS keel_ledger_balance_line_check ON keel_ledger_lines;
CREATE CONSTRAINT TRIGGER keel_ledger_balance_line_check
AFTER INSERT OR UPDATE OR DELETE ON keel_ledger_lines DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION keel_ledger_assert_balanced();

CREATE OR REPLACE FUNCTION keel_ledger_account_currency_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_currency CHAR(3);
BEGIN
 SELECT currency INTO v_currency FROM keel_ledger_accounts
 WHERE tenant_id=NEW.tenant_id AND account_id=NEW.account_id;
 IF v_currency IS NULL OR v_currency<>NEW.currency THEN
  RAISE EXCEPTION 'ledger line currency must match its account currency';
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS keel_ledger_line_currency_check ON keel_ledger_lines;
CREATE TRIGGER keel_ledger_line_currency_check BEFORE INSERT OR UPDATE ON keel_ledger_lines
FOR EACH ROW EXECUTE FUNCTION keel_ledger_account_currency_guard();

CREATE OR REPLACE FUNCTION keel_ledger_account_metadata_guard() RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
 IF (NEW.tenant_id,NEW.account_id,NEW.account_code,NEW.account_name,NEW.account_class,NEW.currency,NEW.normal_side)
    IS DISTINCT FROM
    (OLD.tenant_id,OLD.account_id,OLD.account_code,OLD.account_name,OLD.account_class,OLD.currency,OLD.normal_side) THEN
  RAISE EXCEPTION 'ledger account identity and classification are immutable; use status to suspend or close';
 END IF;
 RETURN NEW;
END; $;
DROP TRIGGER IF EXISTS keel_ledger_account_metadata_immutable ON keel_ledger_accounts;
CREATE TRIGGER keel_ledger_account_metadata_immutable BEFORE UPDATE ON keel_ledger_accounts
FOR EACH ROW EXECUTE FUNCTION keel_ledger_account_metadata_guard();

CREATE UNIQUE INDEX IF NOT EXISTS keel_ledger_single_full_reversal_idx
 ON keel_ledger_journals(tenant_id,reversal_of_journal_id)
 WHERE reversal_of_journal_id IS NOT NULL;
