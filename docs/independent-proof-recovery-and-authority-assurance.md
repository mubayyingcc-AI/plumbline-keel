# Keel Independent Proof, Recovery and Authority Assurance

Status: engineering foundation / sandbox-only; not a production certification.

## Scope
This milestone joins Independent Proof and Recovery Assurance (IPRA) with Keel Authority and Action Assurance (KAAA). These controls protect financial truth, not generic endpoint security. AI may classify, explain and recommend; it cannot grant itself authority, approve its own consequential action, mutate a ledger or override deterministic denial.

## Independent proof checkpoints
A checkpoint signs a canonical body containing tenant, monotonic sequence, prior checkpoint hash, ledger event-head fingerprint, provider event watermark, timestamp and signing key ID. Ed25519 verification requires only the artifact and a separately trusted public key; no Keel database lookup is needed.

Before production: keep private keys in external KMS/HSM; publish signed artifacts to independently administered immutable/WORM storage; distribute public keys and revocation statements through an independent trust channel; verify from a separate account; alert on gaps, rollback, stale checkpoints and signature failure. Define cadence, retention, clock source, dual control, compromise response and RPO. A signature proves a key signed bytes, not that source data was truthful or signer uncompromised.

## Provider sandbox and reconciliation
The deterministic adapter supports idempotent sandbox dispatch, HMAC-SHA256 callback verification, active/previous key overlap during rotation, key retirement and provider identity binding. It is a CI adapter, not a live bank connection.

The production flow must retain atomic ledger/outbox commit; bounded leases; stable provider idempotency keys; UNKNOWN on ambiguous send; exact raw-body signature verification; verified inbox persistence; matching provider identity, idempotency, currency, amount and lifecycle; and no automatic ledger posting/reversal/settlement from callbacks. A production adapter still needs provider credentials, documented signature format, callback registration, mTLS where supported, replay protection, rate limits and provider certification.

## Backup, restore, replay and recovery
Run only against an isolated restore target with provider egress disabled and no production credentials:
1. Take encrypted consistent base backup plus WAL/PITR archive; record backup ID, DB version, migration head, time range and cryptographic manifest.
2. Restore into a clean isolated PostgreSQL instance.
3. Replay and verify the ledger event chain and checkpoint signatures/sequence.
4. Recompute debit, credit and normal-balance projections from posted journal lines using exact integer minor units.
5. Reconcile outbox, inbox and cases. Expired leases and ambiguous provider sends remain UNKNOWN and are never blindly resent.
6. Compare provider sandbox statement/event export to restored Keel state. Missing, duplicate, late, reversed and amount/currency mismatch remain visible exceptions.
7. Record measured RPO/RTO, row counts, hashes, journal totals, provider watermarks, exceptions and independent reviewer sign-off in a signed recovery report.

Acceptance: zero unexplained ledger imbalance; zero cross-tenant visibility; no duplicate external instruction; all UNKNOWN outcomes preserved; evidence chains verifiable; measured RPO/RTO within approved objectives. A successful database restore alone is not successful financial recovery.

## KAAA authority model
An Authority Envelope binds tenant, grantor, grantee, action scopes, resource scope, currency, maximum amount, issue/expiry, revocation and approval requirements. Sub-delegation is denied by default. The evaluator fails closed on invalid, expired, cross-tenant, over-limit and out-of-scope requests.

The consequence map flags hazardous combinations: beneficiary read + payment initiation; beneficiary change + payment release; credential administration + payment initiation; policy change + approval. These are explicit findings, not opaque universal risk scores.

Every consequential action must persist an Action Proof Object: actor and delegated identity, envelope/policy versions, canonical request fingerprint, deterministic decision/reasons, human approvals, before/after state references, execution result and reconciliation status. The current evaluator is a pure deterministic primitive; universal route interception and durable persistence remain integration gates.

## Adversarial release gates
- Compromised agent denied across tenants, outside action/resource scope, after expiry, above amount/currency limits, or when attempting self-approval.
- Revoked/suspended delegation denied at execution time.
- Dangerous capability combinations detected before activation.
- Checkpoint tampering, rollback, wrong key, wrong tenant and broken sequence detected independently.
- Old provider key accepted only during declared overlap; retired/unknown key rejected.
- Timeout/worker crash cannot cause automatic duplicate dispatch.
- Restore/replay preserves exact ledger totals and provider uncertainty.
- CI uses no production secrets, endpoints, migrations or deployment credentials.

## Explicit limitations
This branch adds signed checkpoint primitives, deterministic sandbox adapter and authority evaluator with adversarial unit tests. It does not yet provide KMS/HSM, external WORM publication, production bank/MTO adapter, durable delegation revocation, universal route interception, automated restore drill or measured RPO/RTO. Those are blockers, not implied capabilities.
