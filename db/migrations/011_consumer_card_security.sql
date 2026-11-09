-- Consumer-scoped secure card registry, attestation, pairing, emergency lock and trustee recovery.
-- Private keys, PAN/CVV/PIN, identity documents, biometrics and delivery addresses are never stored.
CREATE TABLE IF NOT EXISTS keel_consumer_cards (
 card_id UUID PRIMARY KEY,
 consumer_id UUID NOT NULL REFERENCES keel_consumer_accounts(consumer_id),
 order_id UUID NOT NULL UNIQUE REFERENCES keel_human_card_orders(order_id),
 partner_id TEXT NOT NULL,
 partner_card_reference_hash CHAR(64) NOT NULL UNIQUE CHECK(partner_card_reference_hash ~ '^[0-9a-f]{64}$'),
 card_state TEXT NOT NULL CHECK(card_state IN ('personalised_pending_attestation','attested_pending_delivery','delivered_pending_pairing','paired','locked','recovery_pending','replacement_required','revoked')),
 device_public_key TEXT NOT NULL,
 key_fingerprint CHAR(64) NOT NULL CHECK(key_fingerprint ~ '^[0-9a-f]{64}$'),
 hardware_model TEXT,
 attestation_verifier_id TEXT,
 attestation_evidence_hash CHAR(64),
 attestation_expires_at TIMESTAMPTZ,
 delivery_verifier_id TEXT,
 delivery_evidence_hash CHAR(64),
 delivered_at TIMESTAMPTZ,
 paired_at TIMESTAMPTZ,
 recovery_group_id UUID,
 recovery_tested_at TIMESTAMPTZ,
 last_counter BIGINT NOT NULL DEFAULT 0 CHECK(last_counter>=0),
 locked_at TIMESTAMPTZ,
 lock_reason TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS keel_consumer_cards_owner_idx ON keel_consumer_cards(consumer_id,created_at DESC);
CREATE TABLE IF NOT EXISTS keel_consumer_card_partner_events (
 partner_id TEXT NOT NULL,
 event_id TEXT NOT NULL,
 order_id UUID NOT NULL REFERENCES keel_human_card_orders(order_id),
 event_type TEXT NOT NULL,
 event_body_hash CHAR(64) NOT NULL,
 received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(partner_id,event_id)
);
CREATE TABLE IF NOT EXISTS keel_consumer_card_verification_events (
 verifier_id TEXT NOT NULL,
 event_id TEXT NOT NULL,
 order_id UUID NOT NULL REFERENCES keel_human_card_orders(order_id),
 verification_type TEXT NOT NULL CHECK(verification_type IN ('hardware_attestation','delivery')),
 evidence_hash CHAR(64) NOT NULL CHECK(evidence_hash ~ '^[0-9a-f]{64}$'),
 received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(verifier_id,event_id)
);
CREATE TABLE IF NOT EXISTS keel_consumer_card_pairing_challenges (
 challenge_id UUID PRIMARY KEY,
 card_id UUID NOT NULL REFERENCES keel_consumer_cards(card_id),
 consumer_id UUID NOT NULL REFERENCES keel_consumer_accounts(consumer_id),
 nonce_hash CHAR(64) NOT NULL CHECK(nonce_hash ~ '^[0-9a-f]{64}$'),
 expected_counter BIGINT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 consumed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS keel_consumer_card_challenges_expiry_idx ON keel_consumer_card_pairing_challenges(expires_at);
CREATE TABLE IF NOT EXISTS keel_consumer_recovery_groups (
 recovery_group_id UUID PRIMARY KEY,
 owner_consumer_id UUID NOT NULL REFERENCES keel_consumer_accounts(consumer_id),
 threshold SMALLINT NOT NULL CHECK(threshold BETWEEN 2 AND 7),
 delay_hours SMALLINT NOT NULL CHECK(delay_hours BETWEEN 24 AND 168),
 status TEXT NOT NULL CHECK(status IN ('active','suspended','revoked')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(recovery_group_id,owner_consumer_id)
);
ALTER TABLE keel_consumer_cards ADD CONSTRAINT keel_consumer_cards_recovery_group_fk FOREIGN KEY(recovery_group_id) REFERENCES keel_consumer_recovery_groups(recovery_group_id);
CREATE TABLE IF NOT EXISTS keel_consumer_recovery_trustees (
 recovery_group_id UUID NOT NULL REFERENCES keel_consumer_recovery_groups(recovery_group_id),
 trustee_consumer_id UUID NOT NULL REFERENCES keel_consumer_accounts(consumer_id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(recovery_group_id,trustee_consumer_id)
);
CREATE TABLE IF NOT EXISTS keel_consumer_recovery_requests (
 recovery_request_id UUID PRIMARY KEY,
 recovery_group_id UUID NOT NULL REFERENCES keel_consumer_recovery_groups(recovery_group_id),
 card_id UUID NOT NULL REFERENCES keel_consumer_cards(card_id),
 owner_consumer_id UUID NOT NULL REFERENCES keel_consumer_accounts(consumer_id),
 reason_code TEXT NOT NULL CHECK(reason_code IN ('lost','stolen','compromised','recovery_test','replacement')),
 status TEXT NOT NULL CHECK(status IN ('pending','approved_waiting_period','rejected','replacement_required','cancelled','completed')),
 threshold_snapshot SMALLINT NOT NULL CHECK(threshold_snapshot BETWEEN 2 AND 7),
 delay_hours_snapshot SMALLINT NOT NULL CHECK(delay_hours_snapshot BETWEEN 24 AND 168),
 eligible_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS keel_consumer_recovery_approvals (
 recovery_request_id UUID NOT NULL REFERENCES keel_consumer_recovery_requests(recovery_request_id),
 trustee_consumer_id UUID NOT NULL REFERENCES keel_consumer_accounts(consumer_id),
 decision TEXT NOT NULL CHECK(decision IN ('approve','reject')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(recovery_request_id,trustee_consumer_id)
);
CREATE TABLE IF NOT EXISTS keel_consumer_card_security_outbox (
 outbox_id UUID PRIMARY KEY,
 consumer_id UUID NOT NULL REFERENCES keel_consumer_accounts(consumer_id),
 card_id UUID NOT NULL REFERENCES keel_consumer_cards(card_id),
 event_type TEXT NOT NULL CHECK(event_type IN ('CARD_EMERGENCY_LOCKED','CARD_RECOVERY_APPROVED','CARD_REPLACEMENT_REQUIRED')),
 payload JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','failed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS keel_consumer_card_outbox_pending_idx ON keel_consumer_card_security_outbox(status,created_at) WHERE status='pending';

CREATE TABLE IF NOT EXISTS keel_consumer_card_security_events (
 event_id UUID PRIMARY KEY,
 consumer_id UUID NOT NULL REFERENCES keel_consumer_accounts(consumer_id),
 card_id UUID NOT NULL REFERENCES keel_consumer_cards(card_id),
 event_type TEXT NOT NULL,
 payload JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS keel_consumer_card_security_events_owner_idx ON keel_consumer_card_security_events(consumer_id,created_at DESC);
CREATE OR REPLACE FUNCTION keel_reject_consumer_card_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Keel consumer card security events are append-only'; END; $$;
DROP TRIGGER IF EXISTS keel_consumer_card_security_events_immutable ON keel_consumer_card_security_events;
CREATE TRIGGER keel_consumer_card_security_events_immutable BEFORE UPDATE OR DELETE ON keel_consumer_card_security_events FOR EACH ROW EXECUTE FUNCTION keel_reject_consumer_card_event_mutation();
