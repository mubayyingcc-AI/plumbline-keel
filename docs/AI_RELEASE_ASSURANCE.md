# Keel AI Release Assurance — domain-neutral core

## Purpose

Provide a vendor-neutral, deterministic evidence contract for assessing changes to AI systems before release. The contract applies to model, prompt, retrieval, dataset, tool, agent, workflow, policy, runtime and integration changes. It is designed to sit alongside—not replace—an organisation's CI/CD, model registry, evaluation harness, identity provider, ticketing system or change-management platform.

## Release evidence contract

A release assessment binds:
- Tenant reference, system, environment, risk tier and change reference.
- Exact component identifiers, versions, kinds and SHA-256 fingerprints.
- Required assurance check categories and each result.
- Evidence artifact references, fingerprints and execution timestamps.
- Independent approval bound to the exact release/component set for high- and critical-risk releases.
- A verified rollback plan and test timestamp for high- and critical-risk releases.

The deterministic result is `SAFE_TO_RELEASE` or `HOLD`. Missing, failed, not-run, waived or evidence-incomplete required checks hold the release. High-risk and critical-risk changes also require scoped independent approval and tested rollback.

## Trust boundaries

The core assesses supplied evidence; it does not execute CI, prove that an artifact URL is authentic, independently authenticate a reviewer, attest that a test harness is honest, or deploy software. The integration layer must authenticate evidence producers, verify artifact provenance, enforce tenant identity, persist append-only proof records and link to external systems. A fingerprint proves byte-level identity of the fingerprinted input, not the truth of its contents.

No decision in this library authorizes automatic deployment or live financial execution. A passing result is not certification, a security audit or regulatory approval.

## Integration roadmap

1. CI adapters: GitHub Actions, GitLab CI, Buildkite, Jenkins and other providers via signed webhooks and OIDC workload identity.
2. AI inventory adapters: model registries, model gateways, prompt/version stores, vector and retrieval indexes, agent frameworks and tool registries.
3. Evidence verification: signed attestations, provenance validation, artifact retention, key rotation and independent proof verification.
4. Enterprise governance: tenant-isolated policy packs, approval delegation, separation of duties, risk-tiered controls, exception expiry and audit exports.
5. Operations: drift monitoring, post-release observation, rollback triggers, incident evidence and recovery exercises.

Provider integrations must be implemented as separate adapters. The core must remain provider-neutral and deterministic. No adapter may promote self-asserted or AI-inferred evidence to independently verified evidence without a verifiable trust mechanism.


## Tenant API and persistence

The current implementation adds:
- `POST /api/ai/release-assessments` — tenant-authenticated assessment creation and immutable persistence.
- `GET /api/ai/release-assessments` — tenant-scoped assessment listing.
- `GET /api/ai/release-assessments/{assessmentId}` — tenant-scoped assessment retrieval.

The PostgreSQL store is tenant-RLS protected, force-RLS enabled and append-only. The runtime role receives SELECT/INSERT only. The API derives the tenant reference from the authenticated API key, not the request body. CI integration tests exercise cross-tenant isolation and mutation rejection.

**Approval boundary:** the ingestion API does not accept caller-asserted high/critical approval as independent approval. Those risk tiers remain on HOLD until a separate authenticated reviewer/approval workflow is implemented. The deterministic library can evaluate a scoped approval object, but a production API must authenticate the approving principal and enforce separation of duties.

## Signed attestations

`src/ai-release-attestation.js` can sign a verified release assessment fingerprint with Ed25519 and verify it against a caller-supplied public key. The signature binds the schema, key ID, issuance timestamp and exact proof fingerprint. Key registration, identity binding, revocation, HSM/KMS custody and trusted CI workload identity are not yet implemented; a signature is only as trustworthy as the out-of-band key trust process.
