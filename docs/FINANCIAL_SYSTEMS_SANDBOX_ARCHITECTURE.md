# Keel Financial Systems Sandbox

**Status:** Architecture specification and implementation boundary  
**Scope:** Global, institution-pluggable financial systems test environment  
**Release posture:** Design/build foundation; not a regulatory sandbox, certification, production integration or live-money environment.

## 1. Purpose

The Keel Financial Systems Sandbox is a permanent platform layer that lets financial institutions, public finance bodies, fintechs, payment providers, custodians, systems integrators and independent developers test Keel integrations in isolated environments before any controlled pilot.

It is not a substitute for the Keel financial core. It is the controlled execution, simulation, verification and evidence environment around the same versioned engines intended for institutional integration.

**Non-negotiable rule:** no separate demo-only financial logic may be presented as proof that the production-intended engine works. Scenario fixtures may be synthetic, but execution must call the actual versioned engine under test. Until an engine is wired into the runner, its test status is **Not executable / Not tested**.

## 2. Global design

The core is jurisdiction-neutral. Country, currency, accounting, privacy, payment-message and regulatory requirements are supplied through versioned profiles and adapters. A jurisdiction profile may constrain an execution; it must not silently redefine global ledger facts.

Support multiple legal entities, books, branches, time zones, accounting calendars, currencies, minor-unit exponents, payment schemes and reporting conventions without hard-coding one country's assumptions.

## 3. Environment classes

1. **Public Test Lab** — anonymous or registered access to synthetic fixtures, public APIs, documented sample scenarios and rate-limited runs. No real customer data, secrets, live payment rails or real-money movement.
2. **Institutional Integration Lab** — private tenant-isolated workspaces, institution-controlled credentials, test endpoints, versioned adapters, scoped datasets and audit logs. Prefer institution-hosted connector agents with outbound-only communication where network policy requires it.
3. **Controlled Pilot Environment** — separately governed, partner- and regulator-approved testing using institution-owned test systems or specifically approved limited real-world data/transactions. Keel cannot grant regulatory permission or self-authorise live testing.

Production must be a separate environment and credential domain, never a promotion toggle from public sandbox.

## 4. Logical architecture

- **Institution Workspace & Identity:** organisation, tenant, users, roles, service identities, MFA/SSO integration, approvals, workspace lifecycle and audit.
- **Keel Connect Gateway:** API authentication, mutual TLS where appropriate, consent/permission scopes, rate limits, schema validation, idempotency, request correlation and adapter routing.
- **Connector Runtime:** REST/OpenAPI, ISO 20022 message adapters, secure file exchange, webhooks/event streams and institution-hosted connector agents. Connector versions and mappings are pinned per run.
- **Scenario Orchestrator:** deterministic fixtures, seeded randomness, clock control, event sequencing, replay, concurrency, failure injection and scenario versioning.
- **Engine Execution Plane:** calls the same Keel engine packages used by institutional integrations: Currency Registry, Ledger, Accounting Periods, Trial Balance, Reconciliation, Treasury, Collateral Integrity, Payment Lifecycle, Authority and Continuity. No sandbox-only duplicate implementation.
- **Assertion & Comparison Engine:** expected-versus-actual comparisons, invariants, tolerances only where explicitly declared, exception classification and reproducible outcomes.
- **Evidence & Test Record:** immutable run manifest, engine/adapter/schema versions, fixture fingerprints, outputs, assertions, signatures, timestamps, reviewer actions and exportable record.
- **Institution Workspace UI:** connector health, scenario catalogue, run history, defects, evidence exports, reviewer workflow and permissions.
- **Operations & Security:** tenant isolation, key management, secrets vault, retention, backups, monitoring, incident response and environment separation.

## 5. Financial engine test families

- Currency registry: ISO 4217 code, effective dates, minor-unit precision, versioned source, redenomination and historical validity.
- Ledger: exact integer minor units, double-entry balance per currency, idempotency, immutability, reversal lineage, tenant isolation and concurrency.
- Accounting periods: book/entity calendars, open/close, controlled adjustments and backdated posting policy.
- Trial balance: account totals independently recomputed from posted journal facts.
- Reconciliation: match, partial match, missing, duplicate, late, reversed, disputed and out-of-order external events.
- Treasury: cash, pending, settled, restricted, reserved, committed and available states without double counting.
- Collateral: source authority, title/ownership evidence, encumbrance, priority, valuation, haircut, freshness and recoverability kept distinct.
- Payments: instruction, authorisation, capture, clearing, settlement, reconciliation and finality kept distinct.
- Human authority/card: mandate scope, consent, limits, reservation, revocation and recovery.
- Human Cash Access / DH-ATM: agent cash, sponsor-backed commitment, customer allocation, voucher, reimbursement and disputes.

## 6. Keel Financial Test Record (KFTR)

Each run produces a canonical record with:
- run ID, workspace ID, institution identifier and environment class;
- scenario ID/version, input manifest and synthetic/approved-data classification;
- Keel engine build, adapter build, API/schema versions and configuration fingerprints;
- currency registry, accounting book and period versions where applicable;
- deterministic seed and controlled clock metadata;
- expected and actual results, assertion-level outcomes and exceptions;
- journal, reservation, reconciliation and evidence references where the engine supports them;
- started/completed timestamps, runner identity and reviewer decisions;
- record fingerprint and signing-key identity/signature where signing is configured.

A SHA-256 fingerprint alone is not an authenticated or independently trustworthy audit trail. KFTR signing requires managed signing keys, key rotation/revocation, canonical serialization, trusted time policy, access controls and independent verification. The record proves what the system recorded and which assertions ran; it does not prove legal title, real-world asset existence, custody, funds availability, regulatory compliance or settlement finality.

## 7. Result semantics

- **Passed:** all required assertions executed and passed against the pinned engine and fixture.
- **Failed:** one or more required assertions failed.
- **Conditional:** result depends on an explicitly recorded unresolved condition or approved tolerance.
- **Not tested:** assertion was not executed, required engine/adapter is unavailable, or evidence is insufficient.
- **Blocked:** execution was prevented by permissions, environment health, invalid fixture or safety boundary.

Never convert Not tested into Passed. A green result is not a certification or regulator endorsement.

## 8. Connector contract

Every connector declares owner, institution, version, supported message families, authentication mode, permissions, data classification, mapping version, idempotency behavior, retry policy, timeout, clock assumptions, error taxonomy, health checks, audit events and decommission/revocation behavior.

Initial interface families:
- REST/JSON with published OpenAPI;
- ISO 20022 message families through versioned adapters;
- secure file import/export with manifest, checksums and replay protection;
- signed webhooks and event streams;
- institution-hosted connector agent with outbound-only connection option.

No connector may silently infer a financial fact absent from the source. Normalisation preserves original source payload reference, mapping version and transformation lineage.

## 9. Isolation and data protection

- Separate tenant identity and storage boundaries; database row-level security is defence in depth, not the sole boundary.
- Public test data is synthetic and carries an explicit synthetic marker.
- Institution test data must be synthetic or explicitly approved/masked by the institution.
- Secrets are never included in fixtures, logs, KFTR exports or browser code.
- Per-workspace credentials, least privilege, scoped tokens, revocation and rate limits.
- No cross-tenant search, identifiers, event replay, cache, logs or evidence visibility.
- Configurable retention, export and deletion subject to institutional/legal obligations.
- No public inbound connection into an institution network by default.

## 10. Test-run lifecycle

1. Create isolated workspace and declare institution, environment and permitted data class.
2. Select a versioned scenario and pin engine, connector, schema, currency and policy versions.
3. Validate permissions, connector health, fixture schema and preconditions.
4. Execute deterministic scenario through the real engine package.
5. Capture outputs, events, journals and exceptions.
6. Run assertions and independent projection/reconciliation checks.
7. Generate KFTR and reviewer/defect record.
8. Replay the same manifest to establish reproducibility.
9. Export evidence and close or retain the workspace under policy.

## 11. Security and release gates

Before external institutional onboarding: threat model, authentication/authorization review, tenant-isolation tests, secrets management, rate limits, abuse controls, audit retention, backup/restore, incident runbooks and API contract review.

Before any controlled pilot: institution approval, data-processing agreement, security assessment, connector approval, defined liability, rollback/stop criteria, independent review and regulatory permission where required.

Before production financial use: complete financial engine coverage, independent accounting/security/database review, operational resilience testing, provider contracts, legal authority, monitoring and disaster recovery. Passing sandbox tests alone is insufficient.

## 12. Explicit non-goals / forbidden shortcuts

- No claims that sandbox testing is regulatory approval or certification.
- No real funds, payment initiation or live account changes in Public Test Lab.
- No fake green checkmarks for engines that have not executed.
- No replacing the real ledger with in-memory demo arithmetic while calling it a ledger test.
- No SHA-256-only claims of tamper-proof or independently verified evidence.
- No automatic promotion from sandbox to production.
- No hard-coded country assumptions in the global core.
- No silent currency conversion, rounding, tolerance or missing-data defaults.
- No synthetic-data label removal or false claim of external institutional connection.

## 13. Initial delivery order

A. Ledger completion gates: global currency registry, accounting periods, trial balance, independent balance verification and reconciliation.  
B. Sandbox foundation: workspace isolation, scenario manifest, deterministic runner, assertion contract, KFTR and test catalogue.  
C. Keel Connect: OpenAPI, ISO 20022 adapters, secure file/webhook contracts and institution-hosted connector agent.  
D. Institutional workspace: onboarding, permissions, run history, defect workflow and evidence export.  
E. Execute Keel's own adversarial test suite before external design-partner onboarding.

The current public runner exposes KFS-001 and KFS-002 through POST /api/sandbox/runs and calls the existing collateral evaluator. It returns a stateless, unsigned KFTR fingerprint; public runs are not persisted and do not create an institutional audit history. Ledger, treasury, payment, collateral and DH-ATM tests must remain Not tested until connected to their real engine implementations.
