# Keel Real-Asset Readiness — controlled institutional testing

## Purpose and boundary
Prepare Keel to receive institution-authorised financial and collateral evidence without becoming a bank, custodian, payment processor, lender, collateral agent, valuation firm or legal-title registry. Initial institutional integration is read-only. No live movement, pledge, release, liquidation, set-off, payment initiation, custody instruction or collateral release is enabled.

## Evidence classes
- Observed: received from a declared source; authenticity not yet established.
- Source-attested: exact payload signature verifies against an active registered source key and permitted evidence scope.
- Verified (source-authenticated): source attestation, tenant scope, object fingerprint and freshness checks pass. This authenticates the source statement, not the underlying legal fact.
- Derived: deterministic calculation from identified inputs and a named policy.
- Estimated / AI-inferred: never eligible as verified evidence or available collateral.
- Simulated: test fixture only; never mixed with live institution records.

## Source attestation
The source-attestation module verifies Ed25519 signatures over canonical JSON payloads. It checks source identity, tenant scope, permitted scope, evidence fingerprint, observation time and source status. The source registry and key lifecycle must be persisted, tenant-administered and independently reviewed before a partner integration is activated. Never accept a public key supplied in the same request as the evidence it purports to authenticate.

## Real-money test stages
1. Synthetic: generated fixtures, all records marked simulated.
2. Partner sandbox: provider sandbox credentials, synthetic accounts/assets and provider test endpoints.
3. Read-only production evidence: institution grants narrow API/statement/registry access; Keel ingests balance, custody, lien, pledge, valuation and settlement evidence without transaction scope.
4. Supervised controlled transaction (optional, later): only if a regulated institution requests it, under its own procedures, signed test plan, named operators, approved counterparties, low caps, dual control, rollback/reconciliation plan and independent sign-off. Keel remains non-executing unless separately licensed, contracted, security-reviewed and explicitly approved.

## Cash / funds evidence
Require institution and account identifiers (tokenised in Keel), currency, ledger and available balances separately, pending debits/credits, restrictions, value date, statement/API source, source event ID, observation timestamp, account-holder/mandate evidence where relevant, and reconciliation reference. A screenshot or user-entered number alone is not source verification. A bank balance is not automatically unencumbered or legally available.

## Collateral evidence
For each asset require stable asset identifier; asset class; issuer/registrar/custodian; legal and beneficial owner as separately evidenced; custody location; quantity and unit; valuation source/time/currency/method; eligibility policy/version; haircut; pledge/lien/charge status; priority and competing claims; control/possession evidence; transfer restrictions; maturity/expiry; insurance where relevant; asset/facility allocation; prior/reused collateral references; and source evidence IDs. Registry searches and legal opinions must come from qualified providers. Keel flags missing/conflicting evidence; it does not issue legal conclusions.

## Mandatory controls before live partner data
- Separate tenants, source connectors, keys and environments; no shared test/production secrets.
- Read-only scopes by default; outbound network allow-list and secret rotation.
- Registered source keys with expiry, revocation, rotation and incident procedures.
- Signed envelope binds tenant, source, evidence ID, external object reference, scope, observation time and object fingerprint.
- Idempotent ingestion; duplicate source event and duplicate asset detection; immutable revisions rather than overwrites.
- Caller cannot self-promote observed, estimated or AI-inferred evidence to verified.
- Unknown/conflicting encumbrance, stale evidence, incomplete title/custody/priority, duplicate or mismatched quantity -> HOLD.
- Separate legal owner, beneficial owner, custodian, controller and pledgee.
- Currency/unit isolation; no cross-currency sum without named timestamped FX source and explicit valuation policy.
- Dual control for source onboarding, key rotation, policy changes and privileged overrides.
- Independent backups, tested restore, incident response, audit export, retention/deletion policy and penetration test.
- Migrations are versioned, transactional and run once by a controlled migration job; not ad-hoc app-startup DDL.
- Monitor ingestion lag, source failures, signature failures, stale evidence, duplicate events, tenant isolation and audit-chain gaps.

## Go-live gates
1. Legal/data-processing agreement, purpose limitation, jurisdiction and retention agreed.
2. Institution and data-source authority verified; named technical and business owners.
3. Read-only credentials and minimum scopes issued by partner.
4. Tenant isolation and access-control tests pass against PostgreSQL.
5. Source attestation, key rotation/revocation and replay/idempotency tests pass.
6. Independent reconciliation against bank/custodian/registrar records passes.
7. Collateral legal/registry evidence responsibilities assigned to qualified parties.
8. Security review, threat model, backup restore and incident exercise pass.
9. Pilot success criteria and discrepancy escalation agreed.
10. Institution signs controlled test report.

## Pilot acceptance criteria
- Every record resolves to tenant, registered source and source event ID.
- Every record has provenance, observation time, evidence class, signature result and immutable fingerprint.
- No cross-tenant read/write is possible in adversarial PostgreSQL integration tests.
- Duplicate/replayed source events are idempotently rejected or return the original result.
- Missing, stale, conflicting or unsupported collateral evidence is held with explicit reasons.
- Balances reconcile to source statements; collateral quantity/value/encumbrance reconcile to source evidence and policy.
- Every derived figure can be reproduced from versioned inputs and policy.
- Authority Chain verifies and an independently exported checkpoint detects privileged database rewrite.
- No transaction side effect occurs during read-only pilot.

## Known implementation gaps
- Source registry/key lifecycle persistence and admin workflow are not implemented yet.
- Current financial object write accepts caller-supplied evidenceStatus; replace with source-attestation-driven status before live evidence.
- Financial object model needs immutable version history, explicit cash balance semantics, asset identifiers, encumbrance/claim relationships, currency precision metadata and provenance envelope.
- Database schema is created at app startup; convert to ordered migrations with schema version tracking and controlled execution.
- Append-only trigger is not tamper-proof against privileged database administrators; add independently held signed checkpoints or external immutable storage.
- Rate limiting is process-local; proxy IP trust needs configuration.
- Full OIDC/SAML/SCIM, MFA, tenant-scoped service identities, granular permissions and separation-of-duties remain incomplete.
- No live bank, custodian, registrar, market-data or payment integrations have been independently tested.
- No independent security, legal, compliance or operational resilience certification has been completed.

## Test fixture rule
Every demo/test record is labelled synthetic or simulated. Never present a fixture, self-declared source, screenshot or unsigned upload as evidence of real funds or collateral.
