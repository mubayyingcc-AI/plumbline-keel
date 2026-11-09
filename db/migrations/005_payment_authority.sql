-- Keel Payment Authority & Execution Control foundation (migration 005).
-- Apply only after migration 004 and verify against the target PostgreSQL schema.
CREATE TABLE IF NOT EXISTS keel_payment_mandates (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), mandate_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 grantor_principal_id UUID NOT NULL, grantee_principal_id UUID NOT NULL, purpose TEXT NOT NULL, scopes JSONB NOT NULL, currency CHAR(3) NOT NULL,
 max_single_minor NUMERIC(78,0) NOT NULL CHECK(max_single_minor>0), period_limit_minor NUMERIC(78,0) NOT NULL CHECK(period_limit_minor>0),
 period_kind TEXT NOT NULL CHECK(period_kind IN ('day','week','month','rolling_30_days')), valid_from TIMESTAMPTZ NOT NULL, valid_until TIMESTAMPTZ NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('proposed','active','suspended','revoked','expired','superseded')), mandate_fingerprint CHAR(64) NOT NULL,
 supersedes_version INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,mandate_id,version),
 FOREIGN KEY(tenant_id,grantor_principal_id) REFERENCES keel_principals(tenant_id,principal_id),
 FOREIGN KEY(tenant_id,grantee_principal_id) REFERENCES keel_principals(tenant_id,principal_id),
 CHECK(valid_until>valid_from), CHECK(grantor_principal_id<>grantee_principal_id)
);
CREATE INDEX IF NOT EXISTS keel_payment_mandates_active_idx ON keel_payment_mandates(tenant_id,status,valid_until);
CREATE TABLE IF NOT EXISTS keel_payment_intents (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), intent_id TEXT NOT NULL, mandate_id TEXT NOT NULL, mandate_version INTEGER NOT NULL,
 idempotency_key TEXT NOT NULL, intent_fingerprint CHAR(64) NOT NULL, policy_id TEXT NOT NULL, policy_version TEXT NOT NULL, currency CHAR(3) NOT NULL,
 amount_minor NUMERIC(78,0) NOT NULL CHECK(amount_minor>0), payee_id TEXT NOT NULL, merchant_id TEXT, purpose TEXT NOT NULL, channel TEXT NOT NULL,
 funding_source_ref TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('proposed','evaluated','approval_required','held','denied','approved','instruction_created','submitted','provider_pending','authorised','captured','clearing','settled','reconciled','declined','expired','cancel_requested','cancelled','reversed','partially_refunded','refunded','disputed','chargeback_won','chargeback_lost','unknown_outcome')),
 decision JSONB, source_snapshot JSONB NOT NULL, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,intent_id), UNIQUE(tenant_id,idempotency_key),
 FOREIGN KEY(tenant_id,mandate_id,mandate_version) REFERENCES keel_payment_mandates(tenant_id,mandate_id,version)
);
CREATE INDEX IF NOT EXISTS keel_payment_intents_tenant_created_idx ON keel_payment_intents(tenant_id,created_at DESC);
CREATE TABLE IF NOT EXISTS keel_payment_reservations (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), reservation_id TEXT NOT NULL, intent_id TEXT NOT NULL, funding_source_ref TEXT NOT NULL,
 currency CHAR(3) NOT NULL, amount_minor NUMERIC(78,0) NOT NULL CHECK(amount_minor>0), state TEXT NOT NULL CHECK(state IN ('active','consumed','released','expired','provider_hold')),
 expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,reservation_id),
 FOREIGN KEY(tenant_id,intent_id) REFERENCES keel_payment_intents(tenant_id,intent_id)
);
CREATE INDEX IF NOT EXISTS keel_payment_reservations_active_idx ON keel_payment_reservations(tenant_id,funding_source_ref,currency,state,expires_at);
CREATE TABLE IF NOT EXISTS keel_payment_approvals (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), approval_id TEXT NOT NULL, intent_id TEXT NOT NULL, principal_id UUID NOT NULL,
 intent_fingerprint CHAR(64) NOT NULL, mandate_version INTEGER NOT NULL, policy_version TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('approve','reject')),
 rationale TEXT NOT NULL, authentication_assurance TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,approval_id),
 FOREIGN KEY(tenant_id,intent_id) REFERENCES keel_payment_intents(tenant_id,intent_id),
 FOREIGN KEY(tenant_id,principal_id) REFERENCES keel_principals(tenant_id,principal_id)
);
CREATE TABLE IF NOT EXISTS keel_payment_provider_events (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), provider_id TEXT NOT NULL, provider_event_id TEXT NOT NULL, intent_id TEXT,
 signature_verified BOOLEAN NOT NULL DEFAULT FALSE, payload_hash CHAR(64) NOT NULL, normalized_event JSONB NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,provider_id,provider_event_id), FOREIGN KEY(tenant_id,intent_id) REFERENCES keel_payment_intents(tenant_id,intent_id)
);
CREATE TABLE IF NOT EXISTS keel_payment_ledger_entries (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), entry_id TEXT NOT NULL, transaction_id TEXT NOT NULL, intent_id TEXT NOT NULL,
 account_code TEXT NOT NULL, side TEXT NOT NULL CHECK(side IN ('debit','credit')), currency CHAR(3) NOT NULL,
 amount_minor NUMERIC(78,0) NOT NULL CHECK(amount_minor>0), source_event_id TEXT NOT NULL, effective_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,entry_id),
 FOREIGN KEY(tenant_id,intent_id) REFERENCES keel_payment_intents(tenant_id,intent_id)
);
CREATE INDEX IF NOT EXISTS keel_payment_ledger_transaction_idx ON keel_payment_ledger_entries(tenant_id,transaction_id);
CREATE TABLE IF NOT EXISTS keel_payment_outbox (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), outbox_id TEXT NOT NULL, intent_id TEXT NOT NULL, provider_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL, payload_hash CHAR(64) NOT NULL, delivery_state TEXT NOT NULL CHECK(delivery_state IN ('pending','leased','sent','retryable_error','permanent_error','unknown_outcome','completed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0), next_attempt_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,outbox_id), UNIQUE(tenant_id,provider_id,idempotency_key), FOREIGN KEY(tenant_id,intent_id) REFERENCES keel_payment_intents(tenant_id,intent_id)
);
CREATE TABLE IF NOT EXISTS keel_payment_evidence (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), evidence_id TEXT NOT NULL, intent_id TEXT NOT NULL, evidence_type TEXT NOT NULL,
 evidence_class TEXT NOT NULL CHECK(evidence_class IN ('self_asserted','source_authenticated','provider_authenticated','independently_verified')),
 source_ref TEXT NOT NULL, payload_hash CHAR(64) NOT NULL, observed_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,evidence_id), FOREIGN KEY(tenant_id,intent_id) REFERENCES keel_payment_intents(tenant_id,intent_id)
);
CREATE TABLE IF NOT EXISTS keel_payment_revocations (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), revocation_id TEXT NOT NULL, mandate_id TEXT NOT NULL, mandate_version INTEGER NOT NULL,
 actor_principal_id UUID NOT NULL, reason TEXT NOT NULL, provider_notification_state TEXT NOT NULL CHECK(provider_notification_state IN ('not_applicable','pending','acknowledged','failed')),
 residual_exposure JSONB NOT NULL DEFAULT '{}'::jsonb, effective_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,revocation_id), FOREIGN KEY(tenant_id,mandate_id,mandate_version) REFERENCES keel_payment_mandates(tenant_id,mandate_id,version),
 FOREIGN KEY(tenant_id,actor_principal_id) REFERENCES keel_principals(tenant_id,principal_id)
);
