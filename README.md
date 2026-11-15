# Plumbline Keel — Decision & Evidence Infrastructure

Vendor-neutral decision, evidence and authority infrastructure for AI systems and financial workflows. The financial engines remain a specialised domain pack. The website and API remain an engineering alpha; they are not production financial infrastructure.

## Run locally

Requires Node.js 18+.

```bash
npm install
npm test
npm start
``

Open `http://127.0.0.1:3000`.

## Current prototype endpoints

- `GET /api/health`
- `GET /api/demo`
- `POST /api/evaluate`
- `POST /api/sandbox/runs` — runs KFS-001 or KFS-002 against the current evaluator and returns an unsigned, stateless KFTR

The public website uses synthetic fixtures. It is not connected to live banks, custodians, payment rails or government systems. Do not submit real customer data or use it to authorise live financial activity.

## Financial Systems Sandbox

Keel's global sandbox architecture is documented in:

- [Financial Systems Sandbox Architecture](docs/FINANCIAL_SYSTEMS_SANDBOX_ARCHITECTURE.md)
- [Sandbox Test Catalogue](docs/SANDBOX_TEST_CATALOG.md)
- [Institutional Sandbox Connect Guide](docs/INSTITUTIONAL_SANDBOX_CONNECT.md)

The website's initial public runner calls the existing synthetic collateral evaluator for KFS-001 and KFS-002 only. Ledger, accounting-period, trial-balance, reconciliation, treasury, payment, card and DH-ATM scenarios remain **Not tested** until the real engines and adapters are integrated. The sandbox must never use a separate demo-only implementation to claim engine correctness.

## Ledger status

The transactional ledger posting/reservation work is under draft PR [#22](https://github.com/mubayyingcc-AI/plumbline-keel/pull/22). Its migrations have been tested in disposable PostgreSQL, not applied to production. It is not production-ready or independently assured.

## Safety and maturity

Keel is not a bank, custodian, payment system, regulator or legal title registry. A cryptographic fingerprint does not prove asset existence, ownership, encumbrance status, funds availability or settlement finality. Sandbox results are technical test evidence—not certification, audit opinion, regulatory approval or permission to execute financial transactions.

No production migration, live financial integration or deployment is authorised by this branch.


## AI Release Assurance

Keel now includes a domain-neutral deterministic release-assessment core for AI companies and enterprises. It can bind exact versions and fingerprints for models, prompts, retrieval indexes, datasets, tools, agents, workflows, policies, runtimes and integrations to required test evidence, risk-tiered approvals and rollback evidence.

- [AI Release Assurance contract and integration roadmap](docs/AI_RELEASE_ASSURANCE.md)
- Implementation: `src/ai-release-assurance.js`
- Tests: `test/ai-release-assurance.test.js`

The current implementation includes a deterministic assessment library, a tenant-authenticated API for immutable PostgreSQL-backed assessments, and Ed25519 release-attestation signing/verification. The API derives tenant identity from the authenticated key and enforces forced RLS; high/critical releases remain on HOLD until an authenticated independent-review workflow is available. Keel does not yet execute CI pipelines or independently authenticate external evidence producers. OIDC/workload identity, CI and model-registry adapters, trusted key registration/revocation, and production rollout remain integration work. The product catalogue marks this status explicitly.


## Organisational Intelligence Control Plane

The isolated `feat/organisational-control-plane-v1` development branch adds a tenant-scoped plugin and agent capability registry, deterministic capability policy evaluation, human-approval-aware action requests, exact target-resource authority binding and immutable evidence linkage to Keel's existing Authority Envelopes and Action Proof Objects. The website includes a synthetic control-plane test lab backed by the same Node.js policy module.

- Architecture: `docs/ORGANISATIONAL_INTELLIGENCE_CONTROL_PLANE.md`
- Policy core: `src/organisational-control-plane.js`
- Tenant API: `src/organisational-control-plane-api.js`
- Migration: `db/migrations/024_organisational_control_plane.sql`
- Public test endpoints: `GET /api/control/sandbox/scenarios`, `POST /api/control/sandbox/runs`
- Authenticated tenant endpoints: `POST/GET /api/control/integrations`, `POST /api/control/integrations/revoke`, `POST /api/control/actions/evaluate`, `GET /api/control/actions`

The API evaluates and records authorisation only. It does not execute external plugin actions or issue an execution token. Production enforcement requires a Keel-mediated connector/gateway or equivalent native enforcement, scoped credentials, verified workload identity, connector-specific security testing and customer approval. Migration 024 is included in the guarded migration runner but has **not** been applied to any environment.


## Infrastructure Finance & Assurance

Keel's Infrastructure Finance & Assurance foundation provides tenant-scoped infrastructure project registration and immutable, reproducible assessment history. It connects asset value, existing encumbrances, haircut assumptions, contracted versus collected revenue, operating costs, debt service, deployed capacity, utilisation and source-evidence states.

- Assessment engine: `src/infrastructure-finance-assurance.js`
- Authenticated API: `src/infrastructure-finance-assurance-api.js`
- Migration: `db/migrations/025_infrastructure_finance_assurance.sql`
- Public synthetic scenarios: `GET /api/infrastructure/sandbox/scenarios`, `POST /api/infrastructure/sandbox/runs`
- Tenant project API: `GET/POST /api/infrastructure/projects`
- Tenant assessment API: `POST /api/infrastructure/assessments`, `GET /api/infrastructure/assessments?projectId=<projectId>`

The engine reports deterministic diagnostics and explicit evidence gaps. It does not provide a credit rating, valuation opinion, legal-title conclusion, financing recommendation or lending decision. Inputs must be independently sourced and verified. No telemetry, bank, custodian, asset registry or NVIDIA connector is connected. Migration 025 has not been applied outside disposable CI.
