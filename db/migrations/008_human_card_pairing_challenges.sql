-- One-time Ed25519 physical-card pairing challenges.
-- Hardware attestation must be established by an independently trusted issuer/device verifier.
-- No private key, PAN, CVV, PIN, seed phrase or biometric template is stored.
ALTER TABLE keel_human_card_devices
 ADD COLUMN IF NOT EXISTS hardware_attestation_verified BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN IF NOT EXISTS hardware_attestation_verifier_id TEXT,
 ADD COLUMN IF NOT EXISTS hardware_attested_at TIMESTAMPTZ;
DO $keel$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='keel_human_card_attestation_evidence_ck') THEN
  ALTER TABLE keel_human_card_devices ADD CONSTRAINT keel_human_card_attestation_evidence_ck
  CHECK (hardware_attestation_verified=FALSE OR (hardware_attestation_verifier_id IS NOT NULL AND hardware_attested_at IS NOT NULL AND attestation_reference IS NOT NULL));
 END IF;
END
$keel$;
CREATE TABLE IF NOT EXISTS keel_human_card_pairing_challenges (
 tenant_id UUID NOT NULL,
 challenge_id UUID NOT NULL,
 card_id TEXT NOT NULL,
 principal_id UUID NOT NULL,
 nonce_hash CHAR(64) NOT NULL CHECK(nonce_hash ~ '^[0-9a-f]{64}$'),
 expected_counter BIGINT NOT NULL CHECK(expected_counter>0),
 expires_at TIMESTAMPTZ NOT NULL,
 consumed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,challenge_id),
 FOREIGN KEY(tenant_id,card_id) REFERENCES keel_human_card_devices(tenant_id,card_id),
 FOREIGN KEY(tenant_id,principal_id) REFERENCES keel_principals(tenant_id,principal_id),
 CHECK(consumed_at IS NULL OR consumed_at>=created_at)
);
CREATE INDEX IF NOT EXISTS keel_human_card_pairing_pending_idx
 ON keel_human_card_pairing_challenges(tenant_id,card_id,expires_at) WHERE consumed_at IS NULL;
