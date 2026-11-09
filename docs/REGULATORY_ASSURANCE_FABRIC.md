# Keel Regulatory Assurance Fabric

Status: architecture specification; implementation and conformity status are NOT complete.

## Purpose

Translate applicable legal, regulatory, contractual and standards obligations into versioned requirements, operational controls, accountable owners, evidence, gap findings, corrective actions and reviewable assessment records. Keel reports evidence coverage and limitations. It must never automatically declare an organisation legally compliant, certified or conformant.

This fabric is a cross-cutting layer. It reuses ModelCensus, DecisionWitness, RuleTrace, DriftSentinel, FallbackMandate, ProofDocket, source attestation, tenant security and Authority Chain. Reuse does not mean those components already satisfy a regulatory requirement.

## Design principles

1. Applicability is explicit and scoped to legal entity, jurisdiction, role (provider, deployer, importer, distributor, product), system, intended purpose, risk classification and assessment date.
2. Every obligation and control is versioned with effective dates, source authority, provenance and supersession history.
3. Requirement mappings are traceable many-to-many. A single control may support several obligations; one obligation may require several controls and evidence classes.
4. Evidence has source, subject, owner, timestamp, collection method, integrity reference, validity interval, classification, access policy and review state.
5. Evidence freshness, completeness, authenticity and effectiveness are separate dimensions. A hash is an integrity fingerprint, not proof of source authenticity.
6. Gap status is deterministic and explainable. AI may assist with extraction and suggested mappings, but a named human approves applicability, mapping, exceptions and closure.
7. Regulatory content updates never silently rewrite historical assessments. New versions create impact assessments and preserve prior snapshots.
8. Tenant boundaries apply to requirements, controls, evidence, findings, actions and exports.
9. Exports disclose missing evidence, assumptions, unresolved findings, exclusions and reviewer decisions.
10. No product UI or API may describe an assessment as certification or legal advice.

## Components and required contracts

### 1. ObligationMap

Stores obligation source, citation locator, jurisdiction, instrument, article/clause, text or licensed reference, version, publication/effective/repeal dates, applicability predicates, regulated role, risk/system scope, evidence expectations and authoritative-source metadata.

Required behaviour:
- immutable obligation versions;
- applicability decision with rationale and reviewer;
- distinguish binding law, harmonised standard, guidance, contract and internal policy;
- effective-date evaluation and jurisdiction overlays;
- preserve the exact requirement snapshot used by an assessment.

### 2. ControlWeave

Maps obligation versions to controls, procedures, technical safeguards, accountable owners, operators, frequency, inputs, outputs, dependencies, design evidence and effectiveness tests.

Required behaviour:
- control lifecycle: proposed, approved, implemented, operating, ineffective, suspended, retired;
- distinguish design adequacy from operating effectiveness;
- map control to responsible role and evidence owner;
- segregation of duties and approval policy;
- record exceptions with scope, rationale, approver and expiry.

### 3. EvidenceLink

Links evidence objects to controls and obligations. Integrates source-attestation and ProofDocket references.

Required behaviour:
- evidence provenance, authenticity method, integrity fingerprint, source identity, acquisition time, validity period and classification;
- immutable evidence versioning and supersession;
- access-controlled document references; do not store secrets or unnecessary personal data in evidence payloads;
- support structured test results, approvals, logs, policies, training records, monitoring reports and supplier attestations;
- distinguish uploaded/self-asserted evidence from independently verified evidence.

### 4. GapSentinel

Deterministic gap and control-effectiveness evaluator.

Required findings include: absent control, unapproved control, stale evidence, unsupported mapping, failed test, missing owner, expired exception, conflicting evidence, overdue action, incomplete applicability and unverified source.

Each finding includes rule/version, inputs, severity, rationale, affected obligation/control, first-seen time, status and reproducible evaluation fingerprint. No opaque LLM score.

### 5. ConformityDocket

Produces a point-in-time assessment package with scope, applicability, obligation versions, mappings, evidence index, control states, test results, findings, exceptions, reviewer approvals, limitations and export manifest.

Assessment states: DRAFT, IN_REVIEW, ACCEPTED_WITH_GAPS, READY_FOR_EXTERNAL_REVIEW, SUPERSEDED. READY_FOR_EXTERNAL_REVIEW is not a declaration of conformity or certification.

### 6. CorrectiveActionLoop

Tracks finding, root cause, risk treatment, action owner, approver, due date, implementation evidence, effectiveness test, reviewer and closure. Closure requires independent verification where policy demands it. Reopening preserves history.

### 7. RegulatoryChangeWatch

Ingests authoritative change notices with source provenance and version comparison. Creates impact assessments against affected obligation versions, products, controls, evidence and open dockets. No automatic legal interpretation or silent control changes. Human approval required before applicability or control mappings change.

## EU AI Act / Article 17 reference profile

Create a jurisdiction-specific profile for Regulation (EU) 2024/1689, including Article 17's quality-management-system areas. The profile must be maintained against authoritative consolidated legislation, Commission decisions and the exact published harmonised-standard text. Do not reproduce or claim conformity with copyrighted standards from secondary summaries.

Article 17(1) area mapping:
- (a) regulatory compliance strategy, including conformity assessment and modification management;
- (b) design, design control and design verification;
- (c) development, quality assurance and quality control;
- (d) examination, test and validation procedures;
- (e) technical specifications, standards and relevant harmonised standards/common specifications;
- (f) data-management systems and procedures;
- (g) Article 9 risk-management system;
- (h) post-market monitoring system;
- (i) serious-incident reporting;
- (j) communication with authorities, notified bodies, other operators, customers and other interested parties;
- (k) records and documentation;
- (l) resource management, including supply security;
- (m) accountability framework and management responsibilities.

The profile must include the complete legal text reference, sub-requirements, applicability, evidence expectations, control mapping and legal reviewer approval. Article 17(4) financial-institution treatment must be modelled precisely and must not be generalized to every financial institution or every AI provider. Keep Articles 9, 10, 11, 12, 13, 14, 15, 20, 26, 43, 72 and 73 as linked obligations where applicable; do not infer that Article 17 alone covers them.

## Proposed persistence model

Tenant-scoped relational entities, with foreign keys and uniqueness constraints:
- regulatory_sources, regulatory_source_versions
- obligations, obligation_versions, applicability_rules, applicability_decisions
- controls, control_versions, obligation_control_mappings
- control_owners, control_tests, control_test_runs
- evidence_objects, evidence_versions, evidence_links, evidence_reviews
- compliance_findings, finding_events
- corrective_actions, corrective_action_events
- conformity_dockets, docket_snapshots, docket_approvals, docket_exports
- regulatory_change_notices, change_impact_assessments
- audit_events linked to Authority Chain

Use append-only event history for decisions and approvals. Enforce tenant_id in every query and database constraint where feasible. Critical write + Authority Chain append must share one database transaction. Add idempotency keys for create/transition/export operations.

## Proposed API surface

All endpoints require tenant authentication, role/permission checks, schema validation, request size limits, idempotency where state-changing, and audit events:
- GET/POST /api/regulatory/sources
- GET/POST /api/regulatory/obligations
- POST /api/regulatory/applicability/evaluate
- GET/POST /api/regulatory/controls
- POST /api/regulatory/mappings
- POST /api/regulatory/evidence/links
- POST /api/regulatory/control-tests
- POST /api/regulatory/gaps/evaluate
- GET /api/regulatory/findings
- POST /api/regulatory/actions
- POST /api/regulatory/dockets
- POST /api/regulatory/dockets/:id/approve
- GET /api/regulatory/dockets/:id/export
- POST /api/regulatory/changes/impact-assessments

These are design contracts, not claims that endpoints currently exist.

## Security and privacy

Tenant isolation, least privilege, MFA/SSO integration, separation of duties, encryption in transit/at rest, key rotation, secrets isolation, malware scanning for uploads, export controls, retention/deletion policies, data minimisation, privacy impact review, legal holds and access audit are release gates. Never place customer confidential documents or personal data in public logs.

## Minimum acceptance tests

- cross-tenant reads/writes are denied at API and database levels;
- obligation versions and historical dockets cannot be overwritten;
- effective dates and role-specific applicability are evaluated deterministically;
- unsupported/expired evidence cannot produce a positive coverage state;
- hash integrity is not confused with source authenticity;
- failed control tests create reproducible findings;
- stale evidence and expired exceptions reopen or downgrade findings;
- action closure requires the required reviewer and effectiveness evidence;
- regulatory updates create impact assessments without silently changing historical decisions;
- export manifest reproduces the exact assessment snapshot;
- concurrent/idempotent requests do not duplicate findings, actions or docket approvals;
- every material transition and approval is linked to Authority Chain in the same transaction;
- data access, retention and deletion rules are tested;
- backup restoration and export verification are demonstrated.

## Completion rule

This layer is complete only when schema, migrations, API, UI/workflow, integrations, tests, security review, operational monitoring, documented procedures and independent legal/standards review are evidenced. A mapping table or generated report alone is not completion.
