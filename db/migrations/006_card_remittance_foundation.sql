-- Card programme, authenticated funding position, atomic reservation, double-entry and remittance foundation.
-- Requires migrations 001-005. Control-plane schema only; no custody or provider execution.
CREATE TABLE IF NOT EXISTS keel_payment_funding_positions (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), funding_source_ref TEXT NOT NULL,
 currency CHAR(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), source_provider_id TEXT NOT NULL,
 source_account_ref TEXT NOT NULL, source_sequence TEXT NOT NULL, source_observed_at TIMESTAMPTZ NOT NULL,
 source_expires_at TIMESTAMPTZ NOT NULL,
 verification_class TEXT NOT NULL CHECK(verification_class IN ('provider_authenticated','independently_verified')),
 reconciliation_state TEXT NOT NULL CHECK(reconciliation_state IN ('reconciled','unreconciled','conflicted')),
 signature_verified BOOLEAN NOT NULL, payload_hash CHAR(64) NOT NULL,
 eligible_balance_minor NUMERIC(78,0) NOT NULL CHECK(eligible_balance_minor>=0),
 restricted_minor NUMERIC(78,0) NOT NULL CHECK(restricted_minor>=0),
 obligations_minor NUMERIC(78,0) NOT NULL CHECK(obligations_minor>=0),
 policy_reserve_minor NUMERIC(78,0) NOT NULL CHECK(policy_reserve_minor>=0),
 provider_holds_minor NUMERIC(78,0) NOT NULL CHECK(provider_holds_minor>=0),
 snapshot_version BIGINT NOT NULL CHECK(snapshot_version>0), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,funding_source_ref,currency), CHECK(source_expires_at>source_observed_at)
);
ALTER TABLE keel_payment_reservations ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE keel_payment_reservations ADD COLUMN IF NOT EXISTS request_fingerprint CHAR(64);
ALTER TABLE keel_payment_reservations ADD COLUMN IF NOT EXISTS funding_snapshot_version BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS keel_payment_reservation_idempotency_uq
 ON keel_payment_reservations(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION keel_reserve_payment_capacity(
 p_tenant_id UUID,p_intent_id TEXT,p_reservation_id TEXT,p_funding_source_ref TEXT,
 p_currency CHAR(3),p_amount_minor NUMERIC,p_idempotency_key TEXT,
 p_request_fingerprint CHAR(64),p_expires_at TIMESTAMPTZ
) RETURNS TABLE(reservation_id TEXT,reservation_state TEXT,available_after_minor NUMERIC)
LANGUAGE plpgsql AS $$
DECLARE pos keel_payment_funding_positions%ROWTYPE;
DECLARE existing keel_payment_reservations%ROWTYPE;
DECLARE active_reserved NUMERIC(78,0);
DECLARE available NUMERIC(78,0);
BEGIN
 IF p_amount_minor IS NULL OR p_amount_minor<=0 OR p_amount_minor<>trunc(p_amount_minor) THEN RAISE EXCEPTION 'reservation_amount_must_be_positive_integer_minor_units'; END IF;
 IF p_idempotency_key IS NULL OR length(p_idempotency_key)<16 OR length(p_idempotency_key)>128 THEN RAISE EXCEPTION 'reservation_idempotency_key_invalid'; END IF;
 IF p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'reservation_fingerprint_invalid'; END IF;
 SELECT * INTO existing FROM keel_payment_reservations r WHERE r.tenant_id=p_tenant_id AND r.idempotency_key=p_idempotency_key FOR UPDATE;
 IF FOUND THEN
  IF existing.intent_id<>p_intent_id OR existing.funding_source_ref<>p_funding_source_ref OR existing.currency<>p_currency OR existing.amount_minor<>p_amount_minor OR existing.request_fingerprint<>p_request_fingerprint THEN RAISE EXCEPTION 'idempotency_key_payload_conflict'; END IF;
  RETURN QUERY SELECT existing.reservation_id,existing.state::TEXT,NULL::NUMERIC; RETURN;
 END IF;
 SELECT * INTO pos FROM keel_payment_funding_positions f WHERE f.tenant_id=p_tenant_id AND f.funding_source_ref=p_funding_source_ref AND f.currency=p_currency FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'verified_funding_position_not_found'; END IF;
 IF pos.verification_class NOT IN ('provider_authenticated','independently_verified') OR pos.signature_verified IS NOT TRUE OR pos.reconciliation_state<>'reconciled' OR pos.source_expires_at<=NOW() OR pos.source_observed_at>NOW()+INTERVAL '60 seconds' THEN RAISE EXCEPTION 'funding_position_not_verified_fresh_and_reconciled'; END IF;
 SELECT COALESCE(SUM(r.amount_minor),0) INTO active_reserved FROM keel_payment_reservations r WHERE r.tenant_id=p_tenant_id AND r.funding_source_ref=p_funding_source_ref AND r.currency=p_currency AND r.state IN ('active','provider_hold') AND r.expires_at>NOW();
 available:=pos.eligible_balance_minor-pos.restricted_minor-pos.obligations_minor-pos.policy_reserve_minor-pos.provider_holds_minor-active_reserved;
 IF available<0 THEN available:=0; END IF;
 IF p_amount_minor>available THEN RAISE EXCEPTION 'insufficient_verified_available_capacity'; END IF;
 IF p_expires_at IS NULL OR p_expires_at<=NOW() OR p_expires_at>NOW()+INTERVAL '24 hours' THEN RAISE EXCEPTION 'reservation_expiry_out_of_range'; END IF;
 INSERT INTO keel_payment_reservations(tenant_id,reservation_id,intent_id,funding_source_ref,currency,amount_minor,state,expires_at,idempotency_key,request_fingerprint,funding_snapshot_version)
 VALUES(p_tenant_id,p_reservation_id,p_intent_id,p_funding_source_ref,p_currency,p_amount_minor,'active',p_expires_at,p_idempotency_key,p_request_fingerprint,pos.snapshot_version);
 RETURN QUERY SELECT p_reservation_id,'active'::TEXT,available-p_amount_minor;
END; $$;

CREATE TABLE IF NOT EXISTS keel_payment_card_programmes (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), programme_id TEXT NOT NULL,
 programme_name TEXT NOT NULL, programme_type TEXT NOT NULL CHECK(programme_type IN ('sandbox','partner_virtual','partner_physical')),
 issuer_provider_id TEXT, programme_manager_provider_id TEXT, jurisdiction TEXT NOT NULL, scheme TEXT,
 status TEXT NOT NULL CHECK(status IN ('sandbox','onboarding','certification','active','suspended','terminated')),
 capabilities JSONB NOT NULL DEFAULT '{}'::jsonb, contract_reference TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,programme_id), CHECK((programme_type='sandbox' AND status='sandbox') OR programme_type<>'sandbox')
);
CREATE TABLE IF NOT EXISTS keel_payment_card_profiles (
 tenant_id UUID NOT NULL, card_id TEXT NOT NULL, principal_id UUID NOT NULL, programme_id TEXT NOT NULL,
 mandate_id TEXT NOT NULL, mandate_version INTEGER NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN ('virtual','physical')),
 issuance_mode TEXT NOT NULL CHECK(issuance_mode IN ('sandbox','partner_issued')),
 provider_card_ref TEXT, provider_token_ref TEXT, display_last_four CHAR(4),
 currency CHAR(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 status TEXT NOT NULL CHECK(status IN ('sandbox','requested','pending_activation','active','suspended','terminated','failed')),
 controls JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,card_id),
 FOREIGN KEY(tenant_id,principal_id) REFERENCES keel_principals(tenant_id,principal_id),
 FOREIGN KEY(tenant_id,programme_id) REFERENCES keel_payment_card_programmes(tenant_id,programme_id),
 FOREIGN KEY(tenant_id,mandate_id,mandate_version) REFERENCES keel_payment_mandates(tenant_id,mandate_id,version),
 CHECK((issuance_mode='sandbox' AND status='sandbox' AND provider_card_ref IS NULL AND provider_token_ref IS NULL) OR issuance_mode='partner_issued'),
 CHECK(display_last_four IS NULL OR display_last_four ~ '^[0-9]{4}$')
);
CREATE INDEX IF NOT EXISTS keel_payment_cards_principal_idx ON keel_payment_card_profiles(tenant_id,principal_id,status);
-- No PAN, CVV, PIN, magnetic stripe or full card credentials are stored in Keel.

CREATE TABLE IF NOT EXISTS keel_payment_ledger_accounts (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), ledger_account_id TEXT NOT NULL,
 account_code TEXT NOT NULL, currency CHAR(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 account_type TEXT NOT NULL CHECK(account_type IN ('asset','liability','equity','income','expense','memo')),
 normal_side TEXT NOT NULL CHECK(normal_side IN ('debit','credit')), status TEXT NOT NULL CHECK(status IN ('active','closed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,ledger_account_id), UNIQUE(tenant_id,account_code,currency)
);
CREATE TABLE IF NOT EXISTS keel_payment_ledger_transactions (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), transaction_id TEXT NOT NULL, intent_id TEXT,
 source_event_id TEXT NOT NULL, transaction_type TEXT NOT NULL, currency CHAR(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 status TEXT NOT NULL CHECK(status IN ('draft','posted','reversed')), description TEXT NOT NULL,
 effective_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,transaction_id), UNIQUE(tenant_id,source_event_id),
 FOREIGN KEY(tenant_id,intent_id) REFERENCES keel_payment_intents(tenant_id,intent_id)
);
CREATE TABLE IF NOT EXISTS keel_payment_ledger_postings (
 tenant_id UUID NOT NULL, posting_id TEXT NOT NULL, transaction_id TEXT NOT NULL, ledger_account_id TEXT NOT NULL,
 side TEXT NOT NULL CHECK(side IN ('debit','credit')), currency CHAR(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 amount_minor NUMERIC(78,0) NOT NULL CHECK(amount_minor>0), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,posting_id),
 FOREIGN KEY(tenant_id,transaction_id) REFERENCES keel_payment_ledger_transactions(tenant_id,transaction_id),
 FOREIGN KEY(tenant_id,ledger_account_id) REFERENCES keel_payment_ledger_accounts(tenant_id,ledger_account_id)
);
CREATE INDEX IF NOT EXISTS keel_payment_ledger_postings_tx_idx ON keel_payment_ledger_postings(tenant_id,transaction_id);
CREATE OR REPLACE FUNCTION keel_assert_posted_ledger_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tx keel_payment_ledger_transactions%ROWTYPE;
DECLARE deb NUMERIC(78,0); DECLARE cred NUMERIC(78,0); DECLARE cnt INTEGER;
BEGIN
 SELECT * INTO tx FROM keel_payment_ledger_transactions WHERE tenant_id=COALESCE(NEW.tenant_id,OLD.tenant_id) AND transaction_id=COALESCE(NEW.transaction_id,OLD.transaction_id);
 IF NOT FOUND OR tx.status<>'posted' THEN RETURN NULL; END IF;
 SELECT COUNT(*),COALESCE(SUM(amount_minor) FILTER(WHERE side='debit'),0),COALESCE(SUM(amount_minor) FILTER(WHERE side='credit'),0)
 INTO cnt,deb,cred FROM keel_payment_ledger_postings WHERE tenant_id=tx.tenant_id AND transaction_id=tx.transaction_id AND currency=tx.currency;
 IF cnt<2 OR deb<>cred THEN RAISE EXCEPTION 'posted_ledger_transaction_must_balance'; END IF;
 RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS keel_ledger_balance_check ON keel_payment_ledger_postings;
CREATE CONSTRAINT TRIGGER keel_ledger_balance_check AFTER INSERT OR UPDATE OR DELETE ON keel_payment_ledger_postings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION keel_assert_posted_ledger_balanced();
DROP TRIGGER IF EXISTS keel_ledger_status_balance_check ON keel_payment_ledger_transactions;
CREATE CONSTRAINT TRIGGER keel_ledger_status_balance_check AFTER INSERT OR UPDATE ON keel_payment_ledger_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION keel_assert_posted_ledger_balanced();

CREATE TABLE IF NOT EXISTS keel_remittance_transfers (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), transfer_id TEXT NOT NULL, canonical_reference TEXT NOT NULL,
 origin_provider_id TEXT NOT NULL, origin_transfer_ref TEXT NOT NULL, corridor_code TEXT NOT NULL,
 source_currency CHAR(3) NOT NULL, destination_currency CHAR(3) NOT NULL,
 sender_reference_hash CHAR(64), recipient_reference_hash CHAR(64),
 state TEXT NOT NULL CHECK(state IN ('initiated','funded','fx_quoted','payout_submitted','payout_pending','recipient_credited','settled','reconciled','failed','returned','reversed','disputed','unknown_outcome')),
 payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,transfer_id), UNIQUE(tenant_id,canonical_reference), UNIQUE(tenant_id,origin_provider_id,origin_transfer_ref)
);
CREATE TABLE IF NOT EXISTS keel_remittance_events (
 tenant_id UUID NOT NULL, provider_id TEXT NOT NULL, provider_event_id TEXT NOT NULL, transfer_id TEXT,
 event_type TEXT NOT NULL, provider_sequence TEXT, signature_verified BOOLEAN NOT NULL, payload_hash CHAR(64) NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL, normalised_event JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,provider_id,provider_event_id),
 FOREIGN KEY(tenant_id,transfer_id) REFERENCES keel_remittance_transfers(tenant_id,transfer_id)
);
CREATE INDEX IF NOT EXISTS keel_remittance_events_transfer_idx ON keel_remittance_events(tenant_id,transfer_id,observed_at);
