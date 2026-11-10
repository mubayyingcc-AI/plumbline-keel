# Keel Financial Systems Sandbox — Test Catalogue v0.1

All fixtures are synthetic unless a private institution workspace explicitly declares an approved data class. Every scenario is versioned and deterministic. The catalogue distinguishes **executable now** from **specified / not yet wired**.

| ID | Test family | Scenario | Required assertions | Current status |
|---|---|---|---|---|
| KFS-001 | Current collateral evaluator | Fresh synthetic evidence and in-scope policy evaluation | Decision, capacity and fingerprint returned by existing evaluator | Executable via POST /api/sandbox/runs; KFTR returned statelessly |
| KFS-002 | Evidence freshness | Stale evidence supplied to evaluator | Conservative hold / issue visible; no silent acceptance | Executable via POST /api/sandbox/runs; stale-evidence assertion and KFTR returned statelessly |
| KFS-003 | Currency precision | Zero-, two- and six-decimal instrument references; exact decimal-string conversion | Integer atomic units; no floating-point acceptance; explicit scale | Executable via GET /api/sandbox/currency/instruments and POST /api/sandbox/currency/precision; no FX or settlement |
| KFS-004 | Ledger balancing | Multi-line journal with balanced debits/credits per currency | Balanced journal posts atomically; imbalance rejected | Backend PostgreSQL integration tests pass; migrations 012/013 applied to staging PostgreSQL 18; no public journal runner yet |
| KFS-005 | Ledger idempotency | Replay same request/idempotency key | Exactly one logical posting | Backend PostgreSQL integration tests pass; public sandbox runner pending |
| KFS-006 | Ledger concurrency | Concurrent reservations/postings on same account | No overspend; bounded retry; deterministic final state | Backend PostgreSQL integration tests pass; public sandbox runner pending |
| KFS-007 | Accounting period | Create books and effective-dated periods; prevent overlaps; post only to open periods and within period dates | Planned periods reject posting; period-bound journal must map to book chart | Tenant-authenticated API and PostgreSQL integration tests pass in staging; dual-control close/reopen remains blocked pending approval workflow |
| KFS-008 | Trial balance | Recompute opening, period movement and closing balances by account and currency | Exact integer minor units; debit/credit equality per currency; no cross-currency netting | Tenant-authenticated trial-balance API and PostgreSQL integration tests pass; no anonymous public ledger write demo |
| KFS-009 | Reconciliation | Duplicate, missing, late, partial, overstated and wrong-type provider events | Differences classified; no false match/finality | Executable synthetic POC via POST /api/sandbox/reconciliation/runs; no durable inbox/outbox or provider feed |
| KFS-010 | Treasury state | Same cash represented as reported, pending, settled, restricted, reserved | No double counting; availability derived under explicit policy | Not tested — treasury engine pending |
| KFS-011 | Collateral integrity | Conflicting ownership, encumbrance, priority and valuation evidence | Facts remain distinct; unknown is not clean | Existing collateral evaluator POC; full institutional source/reconciliation suite pending |
| KFS-012 | Payment authority and lifecycle | Within-mandate, human approval, stale availability, out-of-scope payee | Allow, approval, hold and deny are distinct; no execution | Synthetic mandate evaluator executable via POST /api/sandbox/payment-authority/runs; persistent lifecycle/provider workflow pending |
| KFS-013 | Human authority | Revoke mandate while queued action awaits approval | Revocation prevents new execution; outcome is auditable | Evaluator unit-tested; persistent approval queue and revocation workflow pending |
| KFS-014 | Human Card security | Credential-free sandbox profile with unverified funding source | No PAN/token; unverified, unsigned or unreconciled funds remain HOLD | Executable synthetic profile test via POST /api/sandbox/human-card/runs; no issuer or hardware partner |
| KFS-015 | DH-ATM assurance | Sponsor envelope exists but agent cash is unavailable | No cash-out capacity falsely reported | Not tested — DH-ATM engine pending |
| KFS-016 | Offline conflict | Same bounded offline allocation presented to disconnected terminals | Conflict is detected after sync; liability/dispute path retained | Not tested — offline protocol pending |
| KFS-017 | Period close dual control | Close a balanced period with maker and independent checker | Close hash pins trial balance; requester cannot approve own close; closed period is immutable | Not enabled — close/reopen approval workflow intentionally blocked |

## Acceptance rules

1. Every persisted institutional run must store scenario, engine and connector versions plus fixture fingerprints. Current public synthetic demos are stateless and return the result directly; they do not claim durable evidence storage.
2. Expected results are independent assertions, not values copied from the engine output.
3. Replaying an unchanged deterministic manifest must reproduce the same logical result.
4. Every financial assertion uses integer minor units / BigInt and explicit currency precision.
5. No cross-currency balancing or silent conversion.
6. Missing or stale evidence is a named result, never a successful default.
7. A failure injection must not mutate real systems or cross the workspace boundary.
8. A scenario may only be labelled executable when it calls the corresponding actual engine.
9. Results use Passed, Failed, Conditional, Not tested or Blocked with a reason.
10. Every external test export includes a notice: test evidence, not regulatory certification or production approval.


## Current public synthetic suites

- **Collateral evaluator:** KFS-001 and KFS-002.
- **Currency precision:** exact decimal-string to integer atomic-unit conversion for USD, EUR, NGN and reference/service-credit instruments. This is not FX conversion, transfer or settlement.
- **Payment Authority:** PA-001 through PA-004 exercise allow, human approval, stale-data hold and out-of-scope denial through the real deterministic evaluator.
- **Human Card:** HC-001 creates a credential-free sandbox profile and confirms that self-asserted, unsigned and unreconciled funding is held.
- **Remittance reconciliation:** REC-001 through REC-006 exercise exact match, duplicate idempotency key, amount overstatement, missing event, partial payout and late provider event.

All public synthetic runs are stateless, rate-limited and non-executing. No external bank, MTO, wallet, issuer, custodian or registry feed is connected. The ledger schema, book-scoped chart of accounts, effective-dated periods and forced RLS foundation are deployed in the isolated Railway PostgreSQL 18 staging database. Tenant-authenticated APIs expose book, period, journal and trial-balance operations; no public anonymous write path to institutional ledgers exists. Period close is deliberately disabled until dual-control approval is implemented.

