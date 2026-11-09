-- Physical-first Human Card device registry and auditable activation events.
-- No private keys, seed phrases, biometric templates, PAN, CVV or PIN stored.
CREATE TABLE IF NOT EXISTS keel_human_card_devices (
 tenant_id UUID NOT NULL,
 card_id TEXT NOT NULL,
 principal_id UUID NOT NULL,
 device_public_key TEXT,
 key_fingerprint CHAR(64),
 certificate_reference TEXT,
 hardware_model TEXT,
 attestation_reference TEXT,
 device_status TEXT NOT NULL CHECK(device_status IN ('ordered','dispatched','delivered_pending_pairing','paired','revoked','replaced','lost')),
 lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN ('account_verified','physical_card_ordered','physical_card_dispatched','physical_card_delivered_pending_pairing','physical_card_paired','recovery_configured','virtual_channel_eligible','virtual_channel_active','locked')),
 delivery_verified_at TIMESTAMPTZ,
 paired_at TIMESTAMPTZ,
 recovery_verified_at TIMESTAMPTZ,
 last_challenge_counter BIGINT NOT NULL DEFAULT 0 CHECK(last_challenge_counter>=0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,card_id),
 FOREIGN KEY(tenant_id,principal_id) REFERENCES keel_principals(tenant_id,principal_id),
 CHECK(key_fingerprint IS NULL OR key_fingerprint ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS keel_human_card_active_key_uq ON keel_human_card_devices(tenant_id,key_fingerprint) WHERE key_fingerprint IS NOT NULL AND device_status NOT IN ('revoked','replaced','lost');
CREATE TABLE IF NOT EXISTS keel_human_card_activation_events (
 tenant_id UUID NOT NULL,
 event_id TEXT NOT NULL,
 card_id TEXT NOT NULL,
 principal_id UUID NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('account_verified','physical_card_ordered','physical_card_dispatched','delivery_verified','pairing_challenge_issued','pairing_verified','recovery_configured','recovery_tested','virtual_channel_eligible','virtual_channel_activated','device_locked','device_revoked','device_replaced')),
 evidence_reference TEXT,
 payload_hash CHAR(64) NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
 verifier_id TEXT NOT NULL,
 occurred_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,event_id),
 FOREIGN KEY(tenant_id,card_id) REFERENCES keel_human_card_devices(tenant_id,card_id),
 FOREIGN KEY(tenant_id,principal_id) REFERENCES keel_principals(tenant_id,principal_id)
);
CREATE INDEX IF NOT EXISTS keel_human_card_events_idx ON keel_human_card_activation_events(tenant_id,card_id,occurred_at);
