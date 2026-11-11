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

The current library evaluates supplied evidence. It does not execute CI pipelines, authenticate external evidence providers by itself, or deploy releases. CI, model registry, artifact provenance, identity and audit adapters remain integration work. The product catalogue marks this status explicitly.
