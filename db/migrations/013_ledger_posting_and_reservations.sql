-- Keel ledger posting, projection and reservation foundation.
-- Apply only through a reviewed migration runner after 012 and after PostgreSQL integration tests.
-- Never apply this migration automatically at application startup.

ALTER TABLE keel_ledger_accounts
  ADD COLUMN IF NOT EXISTS allow_negative_balance BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_reservable BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='keel_ledger_account_normal_side_class_check') THEN
    ALTER TABLE keel_ledger_accounts ADD CONSTRAINT keel_ledger_account_normal_side_class_check
      CHECK (account_class='memorandum' OR
        (account_class IN ('asset','expense') AND normal_side='debit') OR
        (account_class IN ('liability','equity','income') AND normal_side='credit'));
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
  FOREIGN KEY(tenant_id,account_id) REFERENCES keel_ledger_accounts(tenant_id,account_id),
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
CREATE INDEX IF NOT EXISTS keel_ledger_reservations_expiry_idx
  ON keel_ledger_reservations(expires_at)
  WHERE status='active' AND expires_at IS NOT NULL;

-- A reversal can reference only a posted original and must remain within the same tenant.
CREATE OR REPLACE FUNCTION keel_ledger_reversal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_status TEXT;
BEGIN
  IF NEW.reversal_of_journal_id IS NOT NULL THEN
    SELECT status INTO original_status FROM keel_ledger_journals
      WHERE tenant_id=NEW.tenant_id AND journal_id=NEW.reversal_of_journal_id;
    IF original_status IS DISTINCT FROM 'posted' THEN
      RAISE EXCEPTION 'ledger reversal must reference a posted journal';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS keel_ledger_reversal_guard_trigger ON keel_ledger_journals;
CREATE TRIGGER keel_ledger_reversal_guard_trigger
  BEFORE INSERT OR UPDATE OF reversal_of_journal_id ON keel_ledger_journals
  FOR EACH ROW EXECUTE FUNCTION keel_ledger_reversal_guard();

-- Database-level defence: a reversal must be an exact line-for-line inverse.
CREATE OR REPLACE FUNCTION keel_ledger_assert_full_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_tenant UUID; v_journal TEXT; v_status TEXT; v_original TEXT;
BEGIN
  v_tenant := COALESCE(NEW.tenant_id,OLD.tenant_id);
  v_journal := COALESCE(NEW.journal_id,OLD.journal_id);
  SELECT status,reversal_of_journal_id INTO v_status,v_original
    FROM keel_ledger_journals WHERE tenant_id=v_tenant AND journal_id=v_journal;
  IF v_status='posted' AND v_original IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM keel_ledger_journals WHERE tenant_id=v_tenant AND journal_id=v_original AND status='posted') THEN
      RAISE EXCEPTION 'reversal original journal must be posted';
    END IF;
    IF EXISTS (
      SELECT account_id,CASE side WHEN 'debit' THEN 'credit' ELSE 'debit' END,currency,amount_minor
        FROM keel_ledger_lines WHERE tenant_id=v_tenant AND journal_id=v_original
      EXCEPT ALL
      SELECT account_id,side,currency,amount_minor
        FROM keel_ledger_lines WHERE tenant_id=v_tenant AND journal_id=v_journal
    ) OR EXISTS (
      SELECT account_id,side,currency,amount_minor
        FROM keel_ledger_lines WHERE tenant_id=v_tenant AND journal_id=v_journal
      EXCEPT ALL
      SELECT account_id,CASE side WHEN 'debit' THEN 'credit' ELSE 'debit' END,currency,amount_minor
        FROM keel_ledger_lines WHERE tenant_id=v_tenant AND journal_id=v_original
    ) THEN
      RAISE EXCEPTION 'reversal journal must exactly invert every original line';
    END IF;
  END IF;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS keel_ledger_full_reversal_header_check ON keel_ledger_journals;
CREATE CONSTRAINT TRIGGER keel_ledger_full_reversal_header_check
  AFTER INSERT OR UPDATE ON keel_ledger_journals DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION keel_ledger_assert_full_reversal();
DROP TRIGGER IF EXISTS keel_ledger_full_reversal_line_check ON keel_ledger_lines;
CREATE CONSTRAINT TRIGGER keel_ledger_full_reversal_line_check
  AFTER INSERT OR UPDATE OR DELETE ON keel_ledger_lines DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION keel_ledger_assert_full_reversal();

-- Tenant isolation. The application must set keel.tenant_id transaction-locally.
-- The runtime database role must not own these tables and must not have BYPASSRLS.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'keel_ledger_accounts','keel_ledger_journals','keel_ledger_lines',
    'keel_ledger_account_balances','keel_ledger_reservations'
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

-- RLS context is intentionally transaction-local. This query should return no rows
-- outside a tenant-scoped transaction when executed as the runtime role.
