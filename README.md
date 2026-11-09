# Plumbline Keel — Financial Infrastructure Foundation

Global, multi-tenant financial state, ledger, authority, collateral and continuity architecture. The website and API remain an engineering alpha; they are not production financial infrastructure.

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
