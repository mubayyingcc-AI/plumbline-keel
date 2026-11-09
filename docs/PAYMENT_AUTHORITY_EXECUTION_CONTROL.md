# Keel Payment Authority & Execution Control

**Status:** Architecture baseline and deterministic evaluation foundation  
**Release class:** Non-executing foundation; no live payment or card issuance  
**Boundary:** Keel is the authority, policy, financial-state and evidence control plane. Licensed banks, issuers, processors, custodians and payment networks retain regulated execution and custody responsibilities.

## 1. Purpose
Keel evaluates whether a proposed payment is within a valid human- or organisation-issued mandate, whether capacity is available after obligations and reservations, whether policy permits the action, and whether the lifecycle can be evidenced. AI may explain, compare, classify and prepare. It cannot grant itself authority, enlarge a mandate, bypass a hold, or manufacture human approval.

The optional Keel Controlled Payment Card is a future access channel. The core capability is channel-neutral and can support bank APIs, supplier payments, approved agent protocols and authorised provider interfaces.

## 2. Position in the architecture
Human / organisation / delegated principal → Mandate Registry → Spend Envelope → Financial State & Availability → Payment Decision Engine → Human approval where required → Payment Orchestrator → External regulated provider → Lifecycle Ledger & Evidence → Recovery & Revocation.

Connects to Treasury Intelligence, Collateral Integrity, Financial Fracture Engine, Authority & Payment Control, Programmable Currency Engine, Reconciliation & Evidence, Financial Continuity and Agent Economy Infrastructure.

## 3. Seven components
1. **Mandate Registry:** versioned grants with owner, principal, agent identity, scopes, purpose, channels, merchants/recipients/categories, geography, currency/instrument, validity, single limit, aggregate limit, approval threshold, funding-source scope, borrowing prohibition, status and revocation lineage.
2. **Spend Envelope:** transaction-time snapshot of applicable mandate and limits. Every evaluation binds to exact mandate version and payment-intent fingerprint. Any material change invalidates approval.
3. **Payment Decision Engine:** deterministic allow / approval-required / hold / deny. Missing, stale, conflicting or untrusted source data fails closed to HOLD / REVIEW.
4. **Human Approval Service:** authenticated principal, clear payee, amount, currency, purpose, fees, timing, funding source and risk. Approval is one-time, short-lived and bound to intent fingerprint + mandate version + policy version. Approval is not provider authorisation.
5. **Payment Orchestrator & Provider Adapters:** outbox/inbox, idempotency, signed webhook verification, replay protection, bounded retries, provider correlation IDs, timeout/unknown-outcome handling and reconciliation.
6. **Payment Ledger & Lifecycle Evidence:** append-only events and balanced double-entry postings when implemented. External provider statement and settlement records remain separately identified.
7. **Recovery & Revocation:** revoke mandate/agent/token, block future instructions, request provider freeze/cancel where supported, record in-flight exposure and reconcile. Revocation cannot reverse completed settlement.

## 4. Financial availability contract
Available-to-spend is not a reported balance. For a single currency and account scope:

available = verified eligible balance - restricted amount - due-obligations reserve - policy reserves - active Keel reservations - provider holds.

Every term carries source, currency, observed-at, effective-at, evidence class, reconciliation status and authority classification. Do not subtract an obligation twice. Do not aggregate currencies without approved FX source, valuation timestamp and risk policy. Unknown or stale terms cause HOLD.

Money uses integer minor units / PostgreSQL NUMERIC(78,0) / JavaScript BigInt. No floating-point money arithmetic. Currency exponent is explicit per instrument.

## 5. Lifecycle state machine
Intent: proposed → evaluated → approval_required | held | denied | approved.  
Provider lifecycle: instruction_created → submitted → provider_pending → authorised → captured → clearing → settled → reconciled.  
Exceptions: declined, expired, cancel_requested, cancelled, reversed, partially_refunded, refunded, disputed, chargeback_won, chargeback_lost, unknown_outcome.

Mandate approval is not card/network authorisation. Authorisation is not capture. Capture is not clearing or settlement. Provider success is not reconciliation. A freeze blocks future activity; it does not erase in-flight obligations. A timeout after submission is UNKNOWN until provider status/reconciliation resolves it. Never blindly retry with a new idempotency key.

Transitions are allow-listed, tenant-scoped and causally linked. Partial capture/refund and incremental authorisation require explicit amount accounting and provider semantics.

## 6. Core data model (migration 005)
- keel_payment_mandates: tenant, mandate ID/version, grantor, grantee/agent, purpose, scopes, counterparties/categories/geographies/channels/instruments, limits, validity, status, fingerprint and supersession.
- keel_payment_intents: immutable canonical request, fingerprint, mandate/policy versions, source snapshot, decision, idempotency key, expiry and state.
- keel_payment_reservations: currency + account scope + amount minor units + state + expiry; unique idempotency scope. Created atomically with fresh availability snapshot.
- keel_payment_approvals: principal, exact intent fingerprint, mandate/policy version, decision, rationale, authentication assurance, expiry and consumed-at.
- keel_payment_provider_events: provider, provider event ID, signature verification, payload hash, normalized event and received-at; unique event ID prevents replay.
- keel_payment_ledger_entries: balanced debit/credit postings, currency, integer minor units, account, transaction and source event; append-only.
- keel_payment_outbox: idempotent provider instruction, payload hash, delivery state, attempts and next-attempt.
- keel_payment_evidence: linked mandate, intent, decision, approval, provider event, ledger postings and reconciliation fingerprints.
- keel_payment_revocations: actor, scope, reason, effective time, provider notification status and residual exposure.

Composite tenant foreign keys enforce tenant isolation at database layer. RLS may add defence-in-depth, not replace query scoping. Use transactions and SELECT FOR UPDATE / serializable isolation for reservations. Write outbox in same transaction as reservation and intent. Provider calls occur outside DB transaction; responses enter through authenticated inbox/webhook processing.

## 7. API contract (phased)
All institutional endpoints require tenant auth, principal identity, role/scope checks, CSRF/origin controls for browser sessions, request-size limits and audit events.
- POST /api/payment-authority/mandates — create proposed mandate; activation is a separate authorised operation.
- POST /api/payment-authority/mandates/{id}/revoke — revoke and record residual exposure.
- GET /api/payment-authority/mandates — list scoped mandates.
- POST /api/payment-authority/intents/evaluate — deterministic non-executing evaluation.
- POST /api/payment-authority/intents/{id}/approve — bind human approval to exact intent; no provider call.
- POST /api/payment-authority/intents/{id}/prepare — create provider-neutral outbox only when adapter enabled.
- POST /api/payment-authority/providers/{provider}/webhooks — verify signature, deduplicate and normalize events.
- GET /api/payment-authority/intents/{id}/lifecycle — tenant-scoped lifecycle/evidence.
- POST /api/payment-authority/reconcile — compare provider records to Keel intents, holds and postings.
- POST /api/payment-authority/kill-switch — freeze future instructions and invoke supported provider controls.

When implemented, the first API endpoint must be a read-only/stateless evaluator backed by server-stored mandates and source-authenticated availability. Client-supplied mandate or balance assertions must never be treated as verified evidence. No public unauthenticated endpoint may create authority, approve or execute payments.

## 8. Threat model and mandatory controls
- Prompt injection / compromised agent: untrusted agent content; server-side scopes; no agent policy mutation.
- Merchant/payee substitution: canonical identity; approval bound to recipient and channel.
- Replay / duplicate / concurrent spend: idempotency uniqueness, nonce/event replay detection, atomic reservation and concurrency tests.
- Stale balances / double counting: source freshness, reconciliation and obligation lineage; unknown means hold.
- Agent identity spoofing: workload identity and signed assertions, not caller-supplied name.
- Approval ambiguity: human-readable receipt, step-up auth, no blanket approval that changes transaction details.
- Key compromise: revocation, rotation, least privilege, HSM/KMS; Keel stores no private wallet keys.
- Provider timeout: UNKNOWN state and reconciliation; no blind duplicate.
- Webhook forgery: provider signature, timestamp/nonce windows and event dedupe.
- Stablecoin depeg/freeze: separate asset risk/legal classification; no assumed par redemption.
- Card data: no PAN/CVV storage or processing by Keel; token references only. PCI scope assessed with issuer/processor and QSA; tokenisation does not automatically remove scope.
- Fraud/disputes: provider rules and evidence preservation; on-chain transfers may lack card-style reversibility.
- Kill switch distinguishes blocking new activity, provider freeze/cancel request and reversal of completed settlement.

## 9. External boundary
Keel does not become a bank, issuer, acquirer, processor, custodian, wallet operator, money transmitter, payment scheme or credit provider merely by implementing this control plane. Every jurisdiction and flow must be mapped by counsel and regulated partners. Partnership does not automatically eliminate Keel's own licensing, outsourcing, data protection, AML, operational resilience or security obligations. Card issuance, stablecoin funding, self-custody, lending and autonomous consumer shopping are excluded from initial release.

## 10. Delivery gates
A. Foundation: deterministic evaluator, architecture contract, schema, website positioning and pure unit tests; no provider calls.  
B. Persistent authority: tenant-scoped mandate lifecycle, named principals, separation of duties, approval binding, DB transaction and concurrency tests.  
C. Ledger & lifecycle: balanced double-entry, holds/reservations, partial capture, settlement, refunds, disputes and reconciliation.  
D. Sandbox adapter: one jurisdiction, one currency, one regulated partner, test credentials, signed webhooks and provider contract tests.  
E. Controlled pilot: independent security review, legal role analysis, runbooks, incident/recovery drills and provider approval.  
F. Optional card channel: issuer/program-manager agreement, network authorisation hooks, tokenised card references, PCI review and dispute operations.

No stage is production-ready until acceptance gates pass. No live financial execution is enabled by this foundation.

## 11. Acceptance tests
1. Missing, expired, revoked, suspended or cross-tenant mandate → deny/hold.
2. Agent scope expansion or borrowing → reject.
3. Material payment detail changes after approval → approval invalid.
4. Exact single/aggregate limits pass; one minor unit above fails.
5. Concurrent reservations cannot overspend daily/monthly limits.
6. Stale, unreconciled, restricted or unknown balance → hold.
7. Same obligation is not reserved twice.
8. Same idempotency key + same request returns same result; changed request fails.
9. Approval is one-time, expires and is consumed atomically.
10. Authorisation does not post settled cash; settlement requires verified evidence.
11. Partial capture/refund leaves correct residual amounts.
12. Forged/replayed webhook rejected; duplicate valid webhook idempotent.
13. Timeout after submission becomes UNKNOWN; no blind second payment.
14. Revocation prevents future requests and exposes in-flight risk.
15. Tenant A cannot access Tenant B rows.
16. Every transition has actor, time, previous/new state, policy/mandate version and evidence fingerprint.
17. NUMERIC(78,0) boundaries remain exact; no JS Number conversion.
18. Provider adapter disabled by default and cannot be enabled by tenant request alone.
19. PAN/CVV/private keys never enter Keel logs, database or evidence.
20. Sandbox reconciliation leaves no unexplained provider/ledger difference.

## 12. Website
Add Payment Authority & Agent Control as a first-class platform section and catalogue item. Explain mandates, spend envelopes, human approval, availability checks, provider-neutral execution boundary, settlement/reconciliation evidence and recovery. Show the controlled card only as a future optional partner-issued channel. Clearly state that website interactions are illustrative and do not move funds.
