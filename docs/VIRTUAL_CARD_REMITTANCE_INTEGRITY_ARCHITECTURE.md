# Keel Virtual Card, Institutional Card Programme & Remittance Integrity
Architecture specification 1.0 — 9 November 2026

## Product boundary
Keel is the authority, state, reservation, accounting, reconciliation and evidence control plane. It is not a bank, issuer, processor, MTO, custodian, wallet operator or card scheme member.

Keel Virtual Card is the first user-facing card experience. Until an authorised issuer is contracted, every profile is an explicitly labelled sandbox profile: no PAN, CVV, PIN, expiry credentials, funding account or real purchase authorisation. It must say “SANDBOX — NOT A PAYMENT CARD”. With an issuer, Keel may hold opaque provider token references and display metadata only.

Keel Institutional Physical Card Programme is a partner-issued pathway for banks, MTOs, EMI/e-money institutions and embedded-finance operators. The authorised issuer/programme manager owns issuance, cardholder onboarding, scheme compliance, card production, safeguarding/custody, regulated execution and issuer-side disputes. Keel supplies the control plane.

A card is a channel, not an account or source of money. Card profiles never create funds or prove availability.

## Shared control architecture
Principal / institution → versioned Mandate Registry → deterministic Payment Decision Engine → authenticated Financial Availability → atomic Spend Reservation → Payment Lifecycle → double-entry Ledger → Provider Reconciliation → ProofDocket / Authority Chain.

The same controls apply to virtual, physical, bank API, wallet, supplier API and remittance payout channels. Distinct permissions are required for viewing state, creating mandates, preparing payments, approving, requesting provider authorisation, executing and reconciling. No user or AI agent may grant or enlarge its own authority, approve its own exception or alter evidence used to authorise its spend. Revocation blocks future Keel instructions; it does not reverse authorisations, captures or settlement already in flight.

## Mandate Registry
Mandates are immutable, tenant-scoped versions linked to authenticated principals. Each version records grantor/grantee, agent identity, purpose, payees, merchants/categories, channels, funding sources, ISO currency, maximum single amount, aggregate period cap, period type, effective dates, status, approval rules, no-borrowing rule, evidence, fingerprint and superseded version. Material changes create a new version; historical versions remain immutable.

## Verified availability
Balances are never accepted from browser/client assertions. Only allowlisted authenticated provider adapters publish funding positions. Each position includes provider/account identity, source sequence, currency, observed/effective times, expiry/freshness, reconciliation state, signature result, payload hash, evidence class, settled eligible balance, restrictions, obligations, policy reserves, provider holds and snapshot version.

Only provider-authenticated or independently verified, signed, fresh, reconciled, non-conflicted records can support a reservation. Self-asserted, simulated, stale, unreconciled, conflicted or incomplete data returns HOLD. A provider statement proves what the provider asserted; it does not alone prove legal ownership, title or unrestricted access.

Eligible capacity = settled eligible balance − restrictions − obligations − policy reserves − provider holds − active Keel reservations. Use integer minor units and NUMERIC(78,0)/BigInt only. Currency is part of every key; no cross-currency netting without explicit timestamped FX evidence and policy.

## Atomic reservation
One PostgreSQL transaction must: lock the funding-position row FOR UPDATE for tenant/source/currency; verify latest source evidence and freshness; load mandate, intent, aggregate usage and policy from server-side records; calculate all deductions and active reservations; insert an idempotent reservation; append Authority Chain event in the same transaction; commit. Concurrent requests against the same source serialize on that row. A duplicate idempotency key replays only when the complete request fingerprint matches. Any failure rolls back both reservation and event. Reservations are internal policy holds, not debits, provider authorisations or settlement.

## Ledger and payment lifecycle
A proper double-entry subledger is required before live execution. Posted transactions balance debits and credits by currency. Ledger entries are append-only; corrections use reversal/adjustment transactions. Posting, lifecycle transition and evidence references are atomic. The Keel subledger does not replace statutory institution books.

Lifecycle: proposed → evaluated → approval_required / held / denied / approved → instruction_created → submitted → provider_pending → authorised → captured → clearing → settled → reconciled. Also model declined, unknown_outcome, cancel_requested, cancelled, reversed, partially_refunded, refunded, disputed, chargeback_won and chargeback_lost. HTTP success, authorisation, capture and webhook delivery never imply settlement. Unknown outcomes require provider status lookup before retry.

## Remittance & embedded-finance integrity
Canonical transfer identity links sender/MTO instruction, source funding, FX quote, compliance decision reference, payout instruction, wallet credit, card spend and reconciliation without conflating events. Six engines: Transfer Origin; Wallet State; Funding & Settlement; Provider Reconciliation; Corridor Risk; Recovery. Adapters normalise provider schemas, verify signatures, enforce timestamp tolerance/replay protection, deduplicate by tenant/provider/event ID, persist payload hashes and redacted events, and process idempotently.

## Target API contract — not enabled yet
- POST/GET /api/payment/mandates; GET /api/payment/mandates/:id; POST /api/payment/mandates/:id/revoke
- POST /api/payment/availability/snapshots (integration-only authenticated source ingestion); GET /api/payment/availability/:fundingSourceRef
- POST /api/payment/intents; POST /api/payment/intents/:id/approve; POST /api/payment/intents/:id/reserve; POST /api/payment/intents/:id/release
- GET/POST /api/payment/cards (sandbox profiles or partner issuance requests only)
- POST /api/payment/provider-events/:providerId (signed, replay-protected)
- GET /api/remittance/transfers and /api/remittance/reconciliation

All institution routes require tenant authentication, role/scope checks and tenant-scoped SQL. End-user sessions need OIDC/OAuth2; tenant API keys must never be shipped to browsers. Endpoints remain disabled until migration and PostgreSQL E2E tests pass.

## Card security and partner model
PAN/CVV/PIN and full card credentials stay with issuer/tokenisation provider. Keel stores opaque token references only; last four may be shown if supplied by provider. Sandbox identifiers are non-routable synthetic labels, not generated card numbers. Per-card controls reference mandates and issuer controls. Keel lock cannot guarantee cancellation of offline or issuer-side pending transactions.

## Provider adapter contract
Each adapter implements signature verification, event normalisation, authoritative balance fetch, payment status lookup, provider authorisation/payment (disabled until release gate), cancel/reverse semantics, statement reconciliation, health and explicit versioned capabilities. Separate sandbox/certification/production credentials; mTLS/OAuth2 where supported; KMS/managed secrets, key rotation, signed outbound requests, bounded retries, dead-letter queue and manual unknown-outcome recovery.

## Mechanical acceptance tests
Mandates: cross-tenant access denied; immutable versioning; expired/suspended/revoked/wrong principal/payee/merchant/channel/funding source rejected; no self-grant or self-approval; approvals bind exact intent fingerprint.
Availability/reservations: unsigned, self-asserted, simulated, stale, unreconciled, conflicted or incomplete source yields HOLD; exact minor-unit arithmetic; no currency mixing; concurrent reservations cannot collectively exceed capacity; idempotency replay requires same fingerprint; rollback leaves no reservation or orphan event; release is idempotent and cannot release consumed/settled value.
Ledger/lifecycle: every posted transaction balances by currency; unbalanced posting fails at commit; duplicate provider events cannot double-post; capture is not settlement; reversals/refunds are new balanced transactions; unknown outcomes block blind retry.
Cards/remittance: sandbox card cannot reach provider execution; no PAN/CVV/PIN in schema/API/logs/evidence; issuer state reconciled; remittance stages remain distinct and traceable; duplicates/out-of-order/missing events are surfaced; revocation preserves residual exposure.

## Release gates
0. Review migration ordering, threat model, data classification and legal roles.
1. Internal sandbox: tenant persistence, OIDC, mandates, trusted source adapters, concurrency-tested reservation, balanced ledger and remittance reconciliation.
2. Issuer sandbox: contracted issuer/programme manager, certification, tokenisation, card lifecycle, webhook verification, PCI scope review and end-to-end tests.
3. Limited live pilot: market/corridor legal opinion, issuer approval, penetration test, independent reconciliation, incident/dispute runbooks and operational support.
4. Scale: HA/DR, RPO/RTO evidence, SLOs, load/concurrency tests, audited controls and partner certification.

This tranche is architecture and schema foundation only. It does not create a live card, bank account, regulated ledger, remittance integration or production payment capability.
