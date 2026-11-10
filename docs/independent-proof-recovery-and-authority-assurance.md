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

Keel now persists Authority Envelopes, scoped resource/action grants, expiry and revocation state, designated independent approvals, and append-only Action Proof Objects. The authenticated ledger journal and reservation create/release/consume routes invoke the authority check inside the same database transaction as the financial write. Successful proofs are linked into the ledger event chain and returned to the caller. Integration-role keys without a named principal are denied financial execution. The current execution adapter supports single-currency delegated journals; delegated multi-currency journal posting is explicitly denied until a multi-currency envelope model is implemented. The KAAA HTTP API creates/revokes envelopes, records approvals and lists proofs. Denied attempts are returned as deterministic errors but are not yet written as durable denied Action Proof Objects; that remains an audit enhancement.

## KAAA API and execution contract
1. A tenant owner/admin first creates a named principal through `POST /api/assurance/principals`. Use `principalKind: "ai_agent"` and `role: "integration"` for an AI agent; the returned API key is bound to that principal. Identity is still self-asserted until an external identity provider is integrated.
 security/global-financial-core-tenant-assurance
2. A named human admin (non-human principals cannot hold the administrative grant role) grants an envelope through `POST /api/assurance/authority/envelopes`. The allowed scopes are `ledger:journal:post`, `ledger:reservation:create`, `ledger:reservation:release`, and `ledger:reservation:consume`. Resource identifiers are exact values such as `book:<bookId>` and `account:<accountId>`. Set currency and a minor-unit amount ceiling for financial actions. Expiry cannot exceed 90 days.

2. A named human admin grants an envelope through `POST /api/assurance/authority/envelopes`. The allowed scopes are `ledger:journal:post`, `ledger:reservation:create`, `ledger:reservation:release`, `ledger:reservation:consume`, `provider:instruction:enqueue`, `provider:instruction:dispatch`, `provider:instruction:recover_expired`, and `provider:instruction:outcome`. Resource identifiers are exact values such as `book:<bookId>` and `account:<accountId>`. Set currency and a minor-unit amount ceiling for financial actions. Expiry cannot exceed 90 days.
 main
3. A delegated financial request supplies the envelope ID in `X-Keel-Authority-Envelope` (or `authorityEnvelopeId` in its JSON body). The ledger transaction revalidates the active tenant key and principal, locks and verifies the envelope fingerprint, checks action/resource/amount/currency/expiry/revocation and required approval, then writes the Action Proof Object and financial event atomically.
4. Where approval is required, the designated independent human principal records an approve/reject decision at `POST /api/assurance/authority/approvals`, bound to the exact 64-character SHA-256 request fingerprint. Approval of a different request fingerprint cannot authorize the actual execution.
5. Revoke with `POST /api/assurance/authority/envelopes/revoke`; inspect durable proofs with `GET /api/assurance/authority/proofs`.

The initial bootstrap owner key has no named principal and therefore cannot post journals or mutate reservations. It must create a named human principal and use that principal-bound key to grant authority. This intentionally removes implicit owner-key financial execution.

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
 security/global-financial-core-tenant-assurance
This branch adds signed checkpoint primitives, deterministic sandbox adapter, durable KAAA envelopes and transaction-bound ledger enforcement. It does not yet provide KMS/HSM, external WORM publication, production bank/MTO adapter, delegated multi-currency journal support, durable denied-attempt proofs, automated restore drill or measured RPO/RTO. Provider dispatch worker enforcement must be added before enabling live external execution.


## Provider instruction and dispatch authority

KAAA distinguishes authority to enqueue a provider instruction from authority to claim it for dispatch. Enqueue binds the journal, provider, aggregate, instruction type, idempotency key, exact amount and currency. Dispatch requires a named worker principal, an explicit provider-scoped dispatch envelope and an exact outbox payload fingerprint before any lease/housekeeping state transition. Missing authority context fails closed. This code does not itself enable a live provider integration.

This branch adds signed checkpoint primitives, deterministic sandbox adapter, durable KAAA envelopes and transaction-bound ledger enforcement. It does not yet provide KMS/HSM, external WORM publication, production bank/MTO adapter, delegated multi-currency journal support, durable denied-attempt proofs, automated restore drill or measured RPO/RTO. An authenticated worker API is available for the deterministic `bank-sandbox` provider only. A real bank/MTO/wallet adapter, provider-specific callback registration, external identity verification, KMS/HSM and independent WORM publication are still release blockers.


## Mainline provider authority controls

The mainline release candidate now requires a named delegated principal and separate, exact resource-scoped authority for provider instruction enqueue, dispatch, expired-lease recovery and dispatch outcome recording. The outbox lease owner must equal the delegated principal ID. Each authority decision is persisted as an Action Proof Object and linked to the ledger event chain in the same transaction as the corresponding state change. Missing context, empty resource grants, unsupported amount/currency and cross-principal worker claims fail closed. Provider callback processing remains separately gated by exact raw-body HMAC verification and provider identity matching.


## Authenticated provider worker API

`POST /api/ledger/provider-instructions` atomically posts the period-bound journal and queues the provider instruction under two explicit authority checks. `POST /api/providers/outbox/claim` requires an integration-role key bound to a named principal plus a provider-scoped `provider:instruction:dispatch` envelope. The current HTTP worker allowlist is fixed to `bank-sandbox`; it does not dispatch to arbitrary provider IDs. `POST /api/providers/outbox/{outboxId}/outcome` requires the same principal to hold the lease and a separate `provider:instruction:outcome` grant. The worker reports accepted, unknown or definitive pre-send failure; unknown remains non-retriable. These endpoints coordinate a worker; they do not claim a live bank integration.


## Automated recovery-state verification

The PostgreSQL 16/18 CI matrix now runs `scripts/verify-recovery-state.js` after migrations and integration tests against a disposable database using the restricted `keel_runtime` role. A separate admin connection enumerates active tenants; every financial read is then executed with transaction-local tenant context. The verifier checks runtime role privileges, tenant isolation, exact ledger projections, trial-balance equality, provider uncertainty/open-case state and the hash-linked ledger event chain. This is a meaningful restore-target verification step, but it is not a substitute for taking an encrypted backup, restoring from WAL/PITR into a clean environment, measuring RPO/RTO and obtaining independent sign-off.
 main
