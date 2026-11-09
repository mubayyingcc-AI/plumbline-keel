-- Keel Regulatory Assurance Fabric v1
-- Tenant-scoped obligations, controls, evidence, findings, actions and immutable assessment snapshots.
CREATE TABLE IF NOT EXISTS keel_regulatory_sources (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), source_id TEXT NOT NULL, source_type TEXT NOT NULL CHECK(source_type IN ('law','harmonised_standard','standard','guidance','contract','internal_policy')),
 jurisdiction TEXT NOT NULL, title TEXT NOT NULL, authority_uri TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,source_id)
);
CREATE TABLE IF NOT EXISTS keel_regulatory_obligations (
 tenant_id UUID NOT NULL, obligation_id TEXT NOT NULL, source_id TEXT NOT NULL, source_version TEXT NOT NULL, locator TEXT NOT NULL, regulated_role TEXT NOT NULL, effective_from TIMESTAMPTZ NOT NULL, effective_to TIMESTAMPTZ, payload JSONB NOT NULL, version_fingerprint CHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,obligation_id,source_version), FOREIGN KEY(tenant_id,source_id) REFERENCES keel_regulatory_sources(tenant_id,source_id), CHECK(effective_to IS NULL OR effective_to>effective_from)
);
CREATE TABLE IF NOT EXISTS keel_regulatory_controls (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), control_id TEXT NOT NULL, version TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('proposed','approved','implemented','operating','ineffective','suspended','retired')), owner_principal_id UUID, payload JSONB NOT NULL, control_fingerprint CHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,control_id,version)
);
CREATE TABLE IF NOT EXISTS keel_regulatory_mappings (
 tenant_id UUID NOT NULL, mapping_id UUID NOT NULL, obligation_id TEXT NOT NULL, obligation_version TEXT NOT NULL, control_id TEXT NOT NULL, control_version TEXT NOT NULL, evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb, approved_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,mapping_id),
 FOREIGN KEY(tenant_id,obligation_id,obligation_version) REFERENCES keel_regulatory_obligations(tenant_id,obligation_id,source_version),
 FOREIGN KEY(tenant_id,control_id,control_version) REFERENCES keel_regulatory_controls(tenant_id,control_id,version)
);
CREATE TABLE IF NOT EXISTS keel_regulatory_evidence (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), evidence_id TEXT NOT NULL, version TEXT NOT NULL, verification_state TEXT NOT NULL CHECK(verification_state IN ('self_asserted','source_authenticated','independently_verified','rejected')), valid_until TIMESTAMPTZ, payload JSONB NOT NULL, evidence_fingerprint CHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,evidence_id,version)
);
CREATE TABLE IF NOT EXISTS keel_regulatory_findings (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), finding_id TEXT NOT NULL, obligation_id TEXT NOT NULL, code TEXT NOT NULL, severity TEXT NOT NULL CHECK(severity IN ('low','moderate','high','critical')), status TEXT NOT NULL CHECK(status IN ('open','in_progress','closed','reopened')), payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,finding_id)
);
CREATE TABLE IF NOT EXISTS keel_regulatory_actions (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), action_id TEXT NOT NULL, finding_id TEXT NOT NULL, owner_principal_id UUID, due_at TIMESTAMPTZ, status TEXT NOT NULL CHECK(status IN ('open','in_progress','implemented','verified','rejected')), payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,action_id), FOREIGN KEY(tenant_id,finding_id) REFERENCES keel_regulatory_findings(tenant_id,finding_id)
);
CREATE TABLE IF NOT EXISTS keel_conformity_dockets (
 tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), docket_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('DRAFT','IN_REVIEW','ACCEPTED_WITH_GAPS','READY_FOR_EXTERNAL_REVIEW','SUPERSEDED')), manifest_fingerprint CHAR(64) NOT NULL, snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,docket_id), UNIQUE(tenant_id,manifest_fingerprint)
);
CREATE INDEX IF NOT EXISTS keel_reg_obligations_tenant_idx ON keel_regulatory_obligations(tenant_id,source_id);
CREATE INDEX IF NOT EXISTS keel_reg_findings_tenant_idx ON keel_regulatory_findings(tenant_id,status,severity);
CREATE INDEX IF NOT EXISTS keel_reg_dockets_tenant_idx ON keel_conformity_dockets(tenant_id,created_at DESC);

CREATE TABLE IF NOT EXISTS keel_regulatory_assessments (tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), assessment_id TEXT NOT NULL, assessment_fingerprint CHAR(64) NOT NULL, snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,assessment_id), UNIQUE(tenant_id,assessment_fingerprint));

CREATE TABLE IF NOT EXISTS keel_regulatory_applicability_decisions (tenant_id UUID NOT NULL REFERENCES keel_tenants(tenant_id), decision_id UUID NOT NULL, obligation_id TEXT NOT NULL, obligation_version TEXT NOT NULL, applicable BOOLEAN NOT NULL, rationale JSONB NOT NULL, reviewer_principal_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,decision_id), FOREIGN KEY(tenant_id,obligation_id,obligation_version) REFERENCES keel_regulatory_obligations(tenant_id,obligation_id,source_version), FOREIGN KEY(tenant_id,reviewer_principal_id) REFERENCES keel_principals(tenant_id,principal_id));
