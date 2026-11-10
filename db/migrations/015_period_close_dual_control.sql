-- Dual-control accounting period close.
-- A period can be closed only after a separate API key approves a pinned trial-balance snapshot.

CREATE TABLE IF NOT EXISTS keel_accounting_period_close_requests (
  tenant_id UUID NOT NULL,
  request_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  requested_by_key_id TEXT NOT NULL,
  trial_balance_hash CHAR(64) NOT NULL CHECK(trial_balance_hash ~ '^[0-9a-f]{64}$'),
  trial_balance_snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','stale')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by_key_id TEXT,
  approved_at TIMESTAMPTZ,
  rejected_by_key_id TEXT,
  rejected_at TIMESTAMPTZ,
  resolution_reason TEXT,
  resolved_at TIMESTAMPTZ,
  version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0),
  PRIMARY KEY(tenant_id,request_id),
  FOREIGN KEY(tenant_id,period_id) REFERENCES keel_accounting_periods(tenant_id,period_id),
  CHECK(approved_by_key_id IS NULL OR approved_by_key_id<>requested_by_key_id),
  CHECK(rejected_by_key_id IS NULL OR rejected_by_key_id<>requested_by_key_id),
  CHECK(
    (status='pending' AND approved_by_key_id IS NULL AND approved_at IS NULL AND rejected_by_key_id IS NULL AND rejected_at IS NULL AND resolved_at IS NULL)
    OR (status='approved' AND approved_by_key_id IS NOT NULL AND approved_at IS NOT NULL AND rejected_by_key_id IS NULL AND rejected_at IS NULL AND resolved_at IS NOT NULL)
    OR (status='rejected' AND rejected_by_key_id IS NOT NULL AND rejected_at IS NOT NULL AND approved_by_key_id IS NULL AND approved_at IS NULL AND resolved_at IS NOT NULL)
    OR (status='stale' AND approved_by_key_id IS NULL AND approved_at IS NULL AND rejected_by_key_id IS NULL AND rejected_at IS NULL AND resolved_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS keel_accounting_period_close_one_pending_idx
  ON keel_accounting_period_close_requests(tenant_id,period_id) WHERE status='pending';

CREATE TABLE IF NOT EXISTS keel_accounting_period_closures (
  tenant_id UUID NOT NULL,
  period_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  close_hash CHAR(64) NOT NULL CHECK(close_hash ~ '^[0-9a-f]{64}$'),
  trial_balance_hash CHAR(64) NOT NULL CHECK(trial_balance_hash ~ '^[0-9a-f]{64}$'),
  journal_count BIGINT NOT NULL CHECK(journal_count>=0),
  trial_balance_snapshot JSONB NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL,
  closed_by_key_id TEXT NOT NULL,
  PRIMARY KEY(tenant_id,period_id),
  UNIQUE(tenant_id,request_id),
  FOREIGN KEY(tenant_id,period_id) REFERENCES keel_accounting_periods(tenant_id,period_id),
  FOREIGN KEY(tenant_id,request_id) REFERENCES keel_accounting_period_close_requests(tenant_id,request_id)
);

CREATE OR REPLACE FUNCTION keel_accounting_period_close_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.tenant_id,NEW.request_id,NEW.period_id,NEW.requested_by_key_id,NEW.trial_balance_hash,NEW.trial_balance_snapshot,NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id,OLD.request_id,OLD.period_id,OLD.requested_by_key_id,OLD.trial_balance_hash,OLD.trial_balance_snapshot,OLD.created_at) THEN
    RAISE EXCEPTION 'period close request evidence is immutable';
  END IF;
  IF OLD.status<>'pending' OR NEW.status NOT IN ('approved','rejected','stale') THEN
    RAISE EXCEPTION 'period close request transition is not permitted';
  END IF;
  IF NEW.status='approved' AND (NEW.approved_by_key_id IS NULL OR NEW.approved_by_key_id=NEW.requested_by_key_id OR NEW.approved_at IS NULL OR NEW.resolved_at IS NULL) THEN
    RAISE EXCEPTION 'period close approval requires an independent checker';
  END IF;
  IF NEW.status='rejected' AND (NEW.rejected_by_key_id IS NULL OR NEW.rejected_by_key_id=NEW.requested_by_key_id OR NEW.rejected_at IS NULL OR NEW.resolved_at IS NULL) THEN
    RAISE EXCEPTION 'period close rejection requires an independent checker';
  END IF;
  IF NEW.status='stale' AND NEW.resolved_at IS NULL THEN
    RAISE EXCEPTION 'stale period close request requires resolution time';
  END IF;
  NEW.version:=OLD.version+1;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS keel_accounting_period_close_request_guard_trigger ON keel_accounting_period_close_requests;
CREATE TRIGGER keel_accounting_period_close_request_guard_trigger
  BEFORE UPDATE ON keel_accounting_period_close_requests
  FOR EACH ROW EXECUTE FUNCTION keel_accounting_period_close_request_guard();

CREATE OR REPLACE FUNCTION keel_accounting_period_closure_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'accounting period closure evidence is append-only';
END; $$;
DROP TRIGGER IF EXISTS keel_accounting_period_closure_immutable_trigger ON keel_accounting_period_closures;
CREATE TRIGGER keel_accounting_period_closure_immutable_trigger
  BEFORE UPDATE OR DELETE ON keel_accounting_period_closures
  FOR EACH ROW EXECUTE FUNCTION keel_accounting_period_closure_immutable();

CREATE OR REPLACE FUNCTION keel_accounting_period_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c keel_accounting_period_closures%ROWTYPE;
DECLARE r keel_accounting_period_close_requests%ROWTYPE;
BEGIN
  IF (NEW.tenant_id,NEW.period_id,NEW.book_id,NEW.period_code,NEW.period_start,NEW.period_end)
     IS DISTINCT FROM
     (OLD.tenant_id,OLD.period_id,OLD.book_id,OLD.period_code,OLD.period_start,OLD.period_end) THEN
    RAISE EXCEPTION 'accounting period identity and date range are immutable';
  END IF;
  IF OLD.status='closed' THEN
    RAISE EXCEPTION 'closed accounting period is immutable; approved reopen workflow required';
  END IF;
  IF NEW.status='closed' THEN
    SELECT * INTO c FROM keel_accounting_period_closures
      WHERE tenant_id=NEW.tenant_id AND period_id=NEW.period_id AND close_hash=NEW.close_hash;
    IF NOT FOUND THEN RAISE EXCEPTION 'approved dual-control closure record required'; END IF;
    SELECT * INTO r FROM keel_accounting_period_close_requests
      WHERE tenant_id=c.tenant_id AND request_id=c.request_id;
    IF NOT FOUND OR r.status<>'approved' OR r.requested_by_key_id=r.approved_by_key_id
       OR r.approved_by_key_id<>NEW.closed_by OR c.closed_by_key_id<>NEW.closed_by
       OR c.trial_balance_hash<>r.trial_balance_hash OR c.closed_at<>NEW.closed_at THEN
      RAISE EXCEPTION 'approved dual-control closure evidence does not match period';
    END IF;
  END IF;
  IF NEW.status<>OLD.status AND NOT (
    (OLD.status='planned' AND NEW.status='open')
    OR (OLD.status='open' AND NEW.status='soft_closed')
    OR (OLD.status='soft_closed' AND NEW.status='closed')
  ) THEN
    RAISE EXCEPTION 'accounting period state transition is not permitted';
  END IF;
  IF NEW.status='open' AND NEW.opened_at IS NULL THEN NEW.opened_at:=NOW(); END IF;
  NEW.version:=OLD.version+1;
  RETURN NEW;
END; $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['keel_accounting_period_close_requests','keel_accounting_period_closures'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS keel_tenant_isolation ON %I',t);
    EXECUTE format(
      'CREATE POLICY keel_tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''keel.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''keel.tenant_id'',true),'''')::uuid)',
      t
    );
  END LOOP;
END $$;
