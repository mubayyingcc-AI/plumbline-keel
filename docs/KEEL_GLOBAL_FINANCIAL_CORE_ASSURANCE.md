# Keel Global Financial Core Assurance

**Release class:** foundational assurance milestone  
**Status:** architecture contract and release gate; not production approval.

## Release decision

Keel is not approved for live financial infrastructure. Existing ledger, accounting-period, tenant-authority and evidence work is a foundation. Product modules must not be described as production-integrated until each one demonstrably uses the shared core and passes the acceptance suite below.

## One authority, one accounting truth, one evidence chain

Every financial product is an adapter over the same tenant-bound core. A product may add domain rules, but it may not create a parallel tenant identity, balance store, posting mechanism, approval authority, or evidence history.

The required request context is derived from authenticated credentials, never trusted from request-body tenant identifiers:

- tenant ID and active tenant status;
- named principal and identity-assurance level;
- API key ID, role, and explicit delegated scopes;
- legal entity, accounting book, and permitted product scope;
- correlation ID and idempotency key;
- policy, schema, and adapter versions.

The context is immutable for the request and bound to transaction-local PostgreSQL RLS state. Missing or ambiguous context fails closed. The database remains the final tenant boundary; application filters are not a substitute.

## Canonical financial lifecycle

All products that create or change financial state must use this lifecycle:

1. **Intake** — validate schema, tenant, principal, product scope, source identity, idempotency and correlation.
2. **Authority** — resolve active mandate, delegated scope, limits, dual-control requirements and expiry.
3. **Evidence** — record source, source reference, observed/ingested timestamps, verification class, freshness, provenance and content fingerprint. A fingerprint alone is not proof of truth.
4. **Assessment** — calculate domain outcome using versioned rules and exact arithmetic. Preserve unknown, stale and conflicting states; never silently coerce them to zero or success.
5. **Decision** — return ALLOW, CONDITIONAL, HOLD or DENY with reason codes, accountable actor and required next control. A decision is not execution.
6. **Commit** — if and only if explicitly authorised, persist domain state and ledger posting in one database transaction; use unique idempotency constraints and serializable/concurrency controls.
7. **External instruction** — write an outbox record in the same transaction. Network calls occur after commit, never inside a ledger transaction.
8. **Provider outcome** — ingest signed, replay-protected provider events through a durable inbox. Distinguish accepted, pending, cleared, settled, reversed, failed and unknown outcome.
9. **Reconcile** — match provider evidence to expected instructions and ledger postings. Exceptions remain open; no synthetic auto-adjustment or silent write-off.
10. **Evidence close** — append immutable, hash-linked events binding input, authority, policy, calculation, journal, outbox, provider event, reconciliation and human approvals.

A timeout after an external instruction is an UNKNOWN outcome, not a failure that may safely be retried as a new payment. Retry only with the same provider idempotency identity or after authoritative reconciliation.

## Shared accounting truth

- All posted financial movements use the canonical double-entry ledger and its tenant-scoped accounts, book, currency and accounting-period rules.
- Amounts use integer minor units or exact decimal arithmetic; never JavaScript binary floating point for money.
- Every journal balances within its legal entity and currency. Cross-currency movements require explicit FX legs and a versioned rate record; currencies are never netted together.
- Posted journals are immutable. Corrections are compensating reversals or adjustments with linked authority and evidence.
- Available balance is not ledger balance: reservations, restrictions, pending obligations and policy holds must be considered separately.
- Account balance projections are rebuildable and continuously checked against posted journal lines.
- Period close pins the exact trial-balance snapshot and requires distinct named principals. Closed-period posting is rejected; reopen requires a separate controlled workflow.

## Evidence chain and independent verification

Each state transition emits an append-only event with tenant sequence, previous fingerprint, event fingerprint, actor, event type and canonical payload. A chain verifier must check sequence continuity, payload fingerprint and stored head. Periodic external anchoring or independently controlled signatures are required before claiming tamper-evidence against a privileged database operator; an in-database hash chain alone is not immutable against a database owner.

Every product's evidence record must link to the same canonical event and journal identifiers. Domain-specific evidence can enrich the record but cannot replace the core history.

## Product integration rule

A product is **CORE-CONNECTED** only when its production API path uses the authenticated tenant context, shared authority resolver, evidence/event writer, canonical ledger/period service where it changes money, and outbox/inbox/reconciliation lifecycle where it touches providers. A UI label, sandbox fixture, mock adapter, or shared database connection is not sufficient.

Products that are read-only or advisory must explicitly declare that they do not post or execute. Products whose data ownership or tenant schema is not yet safe remain disabled or read-only. The existing consumer identity/card routes are not to be re-enabled until ownership, provider authority and cross-tenant tests pass.

## Required product contract

Each product adapter must expose:
- capability manifest and supported lifecycle states;
- required tenant/principal scopes and approval policy;
- source and evidence contract;
- deterministic validation and reason-code taxonomy;
- ledger account/book/period mapping when applicable;
- idempotency and concurrency semantics;
- outbox/inbox and provider reconciliation contract when applicable;
- failure, timeout, reversal and recovery behavior;
- test fixtures and negative/adversarial acceptance tests;
- explicit non-goals and execution boundary.

## Release-blocking acceptance suite

### Tenant and authority
- Tenant A cannot read, mutate, post against, or infer Tenant B data even with a forged foreign tenant ID.
- Missing tenant context, suspended tenant, revoked key, inactive principal, expired delegation, scope mismatch and wrong product role fail closed.
- Runtime has no superuser, BYPASSRLS, auth-owner membership, broad function EXECUTE or unscoped table access.
- New tenant-keyed tables automatically receive forced RLS and least-privilege grants before application use.
- Consumer identity/card routes remain blocked until their tables are tenant-bound and independently tested.

### Ledger and accounting
- Concurrent postings/reservations cannot overspend or produce unbalanced journals.
- Exact idempotent replay returns the original result; same key with different payload is rejected.
- Reversal links to original and cannot be duplicated or silently edited.
- Projection rebuild equals posted journal lines.
- Trial balance balances per currency, book and period; no cross-currency netting.
- Planned, closed, future and out-of-range accounting dates are rejected.
- Distinct principals request and approve period close; self-approval and stale snapshot approval are rejected.

### Provider lifecycle and reconciliation
- Outbox is committed atomically with internal state.
- Duplicate, replayed, out-of-order, late, partial, overpaid, wrong-currency, wrong-provider and unknown provider events are surfaced.
- Network timeout never becomes a false failed or settled state.
- No exception is automatically written off or converted into a balanced journal without an authorised adjustment.

### Evidence and recovery
- Every decision can be reconstructed from pinned input, policy, authority and source versions.
- Tampered payload, missing sequence, altered event head and orphan journal/provider event are detected.
- Backup restore, point-in-time recovery, replay and reconciliation are demonstrated on isolated infrastructure.
- Failure injection covers database disconnect, process restart, provider timeout, duplicate webhook and partial deployment.

### Operations and assurance
- PostgreSQL 16 and 18 CI, disposable integration databases and staging migrations pass.
- Staging migration has preflight, checksum, postflight, backup and tested rollback/forward-recovery procedure.
- Load, concurrency, failover, restore, alerting, incident response and key-rotation drills pass.
- Independent accounting, security, privacy and operational reviewers sign the release evidence.
- Provider-specific contracts, legal responsibilities, data residency and regulatory scope are documented.

## Implemented provider-lifecycle evidence (candidate PR #32)

The candidate implementation adds a durable lifecycle foundation in migration 017 and the shared ledger posting service:

- Tenant-RLS protected outbox, inbox and reconciliation-case tables.
- A single SERIALIZABLE operation posts the journal and enqueues the provider instruction; failure in either step rolls back both.
- Worker claims are bounded by leases. Expired leases become UNKNOWN because the provider may already have received the instruction.
- UNKNOWN outcomes are never automatically re-dispatched. Recovery requires authoritative provider evidence or a controlled manual process.
- HMAC-SHA256 verification covers exact raw webhook bytes, uses constant-time comparison, and binds normalized event fields to the signed payload.
- Replayed provider event IDs with changed payloads are rejected; exact replays are idempotent.
- Reconciliation records matched, pending or exception outcomes without automatically posting, reversing, settling or writing off a ledger journal.

Candidate CI evidence on commit `934107779ccde747897016a57a7ee03243d4ff32`: application CI plus PostgreSQL 16 and PostgreSQL 18 migration, restricted-role and integration suites passed. The tests run against disposable databases; they are not evidence of a production deployment or a real provider connection.

This is a durable core primitive, not a complete provider integration. Provider-specific signature formats, key custody/rotation, mutual TLS, callback registration, provider sandbox certification, operational worker deployment, alerts, and real-money end-to-end certification remain open.

## Current known limitations

The current candidate includes a double-entry ledger, reservations, account projections, accounting books and periods, dual-control close, tenant RLS/authentication, durable provider outbox/inbox primitives, signed-event verification and reconciliation cases. These are not equivalent to a complete global financial infrastructure. Provider-specific adapters and operational workers, backup/restore drills, independent reviews, complete consumer-card tenantization, external evidence anchoring, operational resilience and end-to-end product conformance remain release gates.

## Forbidden shortcuts

- No product-specific shadow ledger or alternate balance truth.
- No tenant ID accepted as authority from an untrusted request body.
- No broad runtime table/function grants or BYPASSRLS runtime role.
- No financial arithmetic using floating point.
- No external network call while a ledger transaction is open.
- No automatic retry of an unknown provider outcome with a new idempotency key.
- No silent reconciliation adjustment, period backdating, self-approved close or mutation of posted journals.
- No treating hashes, synthetic fixtures, screenshots, or successful API responses as proof of ownership, settlement, legal title or regulatory approval.
- No production migration, live funds, card issuance or payment execution as part of this assurance release.

## Promotion rule

This milestone may be called **staging-assured** only after all applicable acceptance tests pass on the exact candidate commit and isolated staging database. It may be considered for a limited, institution-controlled pilot only after independent reviews, restore drills, provider sandbox certification and legal/operational sign-off. Production promotion requires a separate explicit release decision.
