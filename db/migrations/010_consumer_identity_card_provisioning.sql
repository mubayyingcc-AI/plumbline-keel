-- Consumer identity and physical-first Human Card provisioning.
-- No identity documents, biometrics, raw OIDC tokens, card credentials or home addresses stored here.
CREATE TABLE IF NOT EXISTS keel_consumer_accounts (
 consumer_id UUID PRIMARY KEY,
 account_status TEXT NOT NULL DEFAULT 'identity_pending' CHECK(account_status IN ('identity_pending','identity_verified','review_required','rejected','expired','suspended','closed')),
 identity_assurance TEXT NOT NULL DEFAULT 'none' CHECK(identity_assurance IN ('none','substantial','high')),
 identity_provider TEXT,
 identity_evidence_hash CHAR(64),
 identity_verified_at TIMESTAMPTZ,
 identity_expires_at TIMESTAMPTZ,
 last_provider_event_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS keel_consumer_external_identities (
 provider_id TEXT NOT NULL,
 subject_hmac CHAR(64) NOT NULL CHECK(subject_hmac ~ '^[0-9a-f]{64}$'),
 consumer_id UUID NOT NULL REFERENCES keel_consumer_accounts(consumer_id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(provider_id,subject_hmac),
 UNIQUE(consumer_id,provider_id)
);
CREATE TABLE IF NOT EXISTS keel_consumer_identity_events (
 provider_id TEXT NOT NULL,
 provider_event_id TEXT NOT NULL,
 consumer_id UUID NOT NULL REFERENCES keel_consumer_accounts(consumer_id),
 event_status TEXT NOT NULL CHECK(event_status IN ('verified','rejected','review_required','expired')),
 assurance TEXT NOT NULL,
 evidence_hash CHAR(64) NOT NULL CHECK(evidence_hash ~ '^[0-9a-f]{64}$'),
 provider_reference TEXT NOT NULL,
 provider_timestamp TIMESTAMPTZ,
 received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(provider_id,provider_event_id)
);
CREATE INDEX IF NOT EXISTS keel_consumer_identity_events_consumer_idx ON keel_consumer_identity_events(consumer_id,received_at DESC);
CREATE TABLE IF NOT EXISTS keel_human_card_orders (
 order_id UUID PRIMARY KEY,
 idempotency_key TEXT NOT NULL,
 consumer_id UUID NOT NULL REFERENCES keel_consumer_accounts(consumer_id),
 card_product TEXT NOT NULL CHECK(card_product IN ('human-card-standard','human-card-accessible')),
 delivery_country CHAR(2) NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('submitted','partner_accepted','personalised','dispatched','delivery_pending_verification','delivered_pending_pairing','paired','cancelled','suspended')),
 partner_id TEXT,
 partner_order_reference TEXT,
 shipment_reference TEXT,
 delivery_evidence_hash CHAR(64),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(consumer_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS keel_human_card_orders_consumer_idx ON keel_human_card_orders(consumer_id,created_at DESC);
CREATE TABLE IF NOT EXISTS keel_consumer_provisioning_events (
 event_id UUID PRIMARY KEY,
 consumer_id UUID NOT NULL REFERENCES keel_consumer_accounts(consumer_id),
 order_id UUID REFERENCES keel_human_card_orders(order_id),
 previous_state TEXT,
 new_state TEXT NOT NULL,
 event_type TEXT NOT NULL,
 evidence_hash CHAR(64),
 external_reference TEXT,
 actor_type TEXT NOT NULL CHECK(actor_type IN ('identity_provider','card_partner','delivery_verifier','issuer','keel_operator')),
 occurred_at TIMESTAMPTZ NOT NULL,
 received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS keel_consumer_provisioning_events_order_idx ON keel_consumer_provisioning_events(order_id,received_at DESC);
CREATE TABLE IF NOT EXISTS keel_consumer_event_chain (
 sequence BIGSERIAL PRIMARY KEY,
 event_id UUID NOT NULL UNIQUE,
 event_type TEXT NOT NULL,
 subject_id UUID NOT NULL,
 previous_fingerprint CHAR(64),
 event_fingerprint CHAR(64) NOT NULL UNIQUE CHECK(event_fingerprint ~ '^[0-9a-f]{64}$'),
 payload JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE OR REPLACE FUNCTION keel_reject_consumer_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Keel consumer events are append-only'; END; $$;
DROP TRIGGER IF EXISTS keel_consumer_event_chain_immutable ON keel_consumer_event_chain;
CREATE TRIGGER keel_consumer_event_chain_immutable BEFORE UPDATE OR DELETE ON keel_consumer_event_chain FOR EACH ROW EXECUTE FUNCTION keel_reject_consumer_event_mutation();
