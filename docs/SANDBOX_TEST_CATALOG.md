# Keel Financial Systems Sandbox — Test Catalogue v0.1

All fixtures are synthetic unless a private institution workspace explicitly declares an approved data class. Every scenario is versioned and deterministic. The catalogue distinguishes **executable now** from **specified / not yet wired**.

| ID | Test family | Scenario | Required assertions | Current status |
|---|---|---|---|---|
| KFS-001 | Current collateral evaluator | Fresh synthetic evidence and in-scope policy evaluation | Decision, capacity and fingerprint returned by existing evaluator | Executable via existing /api/evaluate endpoint |
| KFS-002 | Evidence freshness | Stale evidence supplied to evaluator | Conservative hold / issue visible; no silent acceptance | Executable via existing evaluator fixture |
| KFS-003 | Currency registry | Zero-, two- and three-decimal currencies; effective-date and redenomination fixture | Exact exponent; no float arithmetic; version pinned | Not tested — registry not yet integrated |
| KFS-004 | Ledger balancing | Multi-line journal with balanced debits/credits per currency | Balanced journal posts atomically; imbalance rejected | Not tested — ledger PR #22 is open draft |
| KFS-005 | Ledger idempotency | Replay same request/idempotency key | Exactly one logical posting | Not tested — runner adapter pending |
| KFS-006 | Ledger concurrency | Concurrent reservations/postings on same account | No overspend; bounded retry; deterministic final state | Not tested — runner adapter pending |
| KFS-007 | Accounting period | Attempt posting to closed period and controlled backdate | Rejected or routed to approved adjustment policy | Not tested — period engine pending |
| KFS-008 | Trial balance | Recompute balances from posted journal facts | Debits/credits and account balances agree | Not tested — reporting engine pending |
| KFS-009 | Reconciliation | Duplicate, missing, late, partial, reversed and out-of-order statement events | Differences classified; no false match/finality | Not tested — reconciliation engine pending |
| KFS-010 | Treasury state | Same cash represented as reported, pending, settled, restricted, reserved | No double counting; availability derived under explicit policy | Not tested — treasury engine pending |
| KFS-011 | Collateral integrity | Conflicting ownership, encumbrance, priority and valuation evidence | Facts remain distinct; unknown is not clean | Not tested — full engine suite pending |
| KFS-012 | Payment lifecycle | Instruction through authorisation, clearing, settlement and reconciliation | States never conflated; duplicate/replay handled | Not tested — lifecycle engine pending |
| KFS-013 | Human authority | Revoke mandate while queued action awaits approval | Revocation prevents new execution; outcome is auditable | Not tested — runner adapter pending |
| KFS-014 | DH-ATM assurance | Sponsor envelope exists but agent cash is unavailable | No cash-out capacity falsely reported | Not tested — DH-ATM engine pending |
| KFS-015 | Offline conflict | Same bounded offline allocation presented to disconnected terminals | Conflict is detected after sync; liability/dispute path retained | Not tested — offline protocol pending |

## Acceptance rules

1. Every run stores the scenario version, engine version, connector version and fixture fingerprint.
2. Expected results are independent assertions, not values copied from the engine output.
3. Replaying an unchanged deterministic manifest must reproduce the same logical result.
4. Every financial assertion uses integer minor units / BigInt and explicit currency precision.
5. No cross-currency balancing or silent conversion.
6. Missing or stale evidence is a named result, never a successful default.
7. A failure injection must not mutate real systems or cross the workspace boundary.
8. A scenario may only be labelled executable when it calls the corresponding actual engine.
9. Results use Passed, Failed, Conditional, Not tested or Blocked with a reason.
10. Every external test export includes a notice: test evidence, not regulatory certification or production approval.
