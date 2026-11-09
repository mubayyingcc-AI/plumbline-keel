-- Human Card recovery: independent trustees, threshold approvals and enforced delay.
CREATE TABLE IF NOT EXISTS keel_human_card_recovery_groups (
 tenant_id UUID NOT NULL,
 recovery_group_id UUID NOT NULL,
 owner_principal_id UUID NOT NULL,
 threshold SMALLINT NOT NULL CHECK(threshold BETWEEN 2 AND 7),
 delay_hours SMALLINT NOT NULL CHECK(delay_hours BETWEEN 24 AND 168),
 status TEXT NOT NULL CHECK(status IN ('active','suspended','revoked')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,recovery_group_id),
 UNIQUE(tenant_id,owner_principal_id,recovery_group_id),
 FOREIGN KEY(tenant_id,owner_principal_id) REFERENCES keel_principals(tenant_id,principal_id)
);
CREATE TABLE IF NOT EXISTS keel_human_card_recovery_trustees (
 tenant_id UUID NOT NULL,
 recovery_group_id UUID NOT NULL,
 trustee_principal_id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,recovery_group_id,trustee_principal_id),
 FOREIGN KEY(tenant_id,recovery_group_id) REFERENCES keel_human_card_recovery_groups(tenant_id,recovery_group_id),
 FOREIGN KEY(tenant_id,trustee_principal_id) REFERENCES keel_principals(tenant_id,principal_id)
);
CREATE TABLE IF NOT EXISTS keel_human_card_recovery_requests (
 tenant_id UUID NOT NULL,
 recovery_request_id UUID NOT NULL,
 card_id TEXT NOT NULL,
 owner_principal_id UUID NOT NULL,
 recovery_group_id UUID NOT NULL,
 reason_code TEXT NOT NULL CHECK(reason_code IN ('card_lost','card_stolen','device_compromised','recovery_test','replacement')),
 status TEXT NOT NULL CHECK(status IN ('pending','approved_waiting_period','rejected','replacement_pending','expired','cancelled')),
 threshold_snapshot SMALLINT NOT NULL CHECK(threshold_snapshot BETWEEN 2 AND 7),
 delay_hours_snapshot SMALLINT NOT NULL CHECK(delay_hours_snapshot BETWEEN 24 AND 168),
 eligible_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 completed_at TIMESTAMPTZ,
 PRIMARY KEY(tenant_id,recovery_request_id),
 FOREIGN KEY(tenant_id,card_id) REFERENCES keel_human_card_devices(tenant_id,card_id),
 FOREIGN KEY(tenant_id,owner_principal_id) REFERENCES keel_principals(tenant_id,principal_id),
 FOREIGN KEY(tenant_id,recovery_group_id) REFERENCES keel_human_card_recovery_groups(tenant_id,recovery_group_id)
);
CREATE TABLE IF NOT EXISTS keel_human_card_recovery_approvals (
 tenant_id UUID NOT NULL,
 recovery_request_id UUID NOT NULL,
 trustee_principal_id UUID NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('approve','reject')),
 rationale_code TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,recovery_request_id,trustee_principal_id),
 FOREIGN KEY(tenant_id,recovery_request_id) REFERENCES keel_human_card_recovery_requests(tenant_id,recovery_request_id),
 FOREIGN KEY(tenant_id,trustee_principal_id) REFERENCES keel_principals(tenant_id,principal_id)
);
CREATE INDEX IF NOT EXISTS keel_human_card_recovery_owner_idx ON keel_human_card_recovery_requests(tenant_id,owner_principal_id,status,created_at DESC);
