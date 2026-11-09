# Keel Ledger Foundation and Control Model

**Status:** Engineering foundation — not production financial infrastructure  
**Scope:** Global, multi-tenant ledger core  
**Migration dependency:** 012 (double-entry journal) and 013 (posting, projections, reservations, event evidence)  
**Reviewed against:** PostgreSQL 16 disposable integration environment and restricted runtime role  
**Date:** 9 November 2026

## 1. Purpose

Keel's ledger is the financial source-of-record foundation for later products. It must not be confused with a payment switch, issuer, custodian, deposit-taking institution or settlement system. The ledger records and controls accounting facts supplied by authorised Keel services and regulated providers; it does not create legal ownership, custody, funds availability or settlement finality by itself.

The current tranche establishes:
- tenant-scoped accounts and double-entry journals;
- exact integer minor-unit posting;
- atomic PostgreSQL posting;
- immutable posted journals and compensating reversals;
- idempotent journal and reservation requests;
- rebuildable balance projections;
- available-balance reservations;
- a per-tenant hash-linked append-only ledger event stream;
- tenant row-level security and PostgreSQL integration tests.

## 2. Global monetary representation

Every monetary amount is a positive decimal integer string in the currency's configured minor unit. JavaScript uses BigInt; PostgreSQL stores journal amounts and projections in integer-scale NUMERIC, never floating point.

Each ledger account stores:
- ISO-style three-letter currency code;
- explicit currency minor-unit exponent (0–6);
- account class and normal side;
- account status;
- whether negative normal balance is permitted;
- whether the account can be reserved against.

The exponent is immutable after configuration. Existing legacy accounts with no configured exponent cannot be used for posting until configured. The exponent supplied during account creation is configuration data; before production, Keel must validate it against a versioned, source-backed currency master-data registry. A three-letter code alone is not proof of ISO 4217 validity or current minor-unit precision.

A journal balances independently for each currency. Keel does not net USD against EUR, NGN against GBP or any other currencies. Cross-currency activity requires a separately authorised FX trade, rate source, valuation timestamp, spread/fee treatment and two-sided accounting.

## 3. Account and journal model

### Account classes
- **Asset** — normal debit balance.
- **Liability** — normal credit balance.
- **Equity** — normal credit balance.
- **Income** — normal credit balance.
- **Expense** — normal debit balance.
- **Memorandum** — configurable normal side; not a substitute for recognised financial-statement accounts.

The account metadata guard protects identity, classification, currency and configured currency exponent. Operational status and policy flags require controlled administration and audit.

### Journal lifecycle
DRAFT → POSTED

Posted journals and lines are immutable. Corrections are represented by a new compensating journal; the original is never edited or deleted.

A full reversal:
- references an existing posted journal in the same tenant;
- exactly mirrors every original line, switching debit/credit sides;
- is unique per original journal;
- is checked in the application and again by deferred PostgreSQL constraints.

Partial corrections, adjustment journals and period-end accruals require explicit source and policy treatment; they are not implemented by editing a posted journal.

## 4. Atomic posting protocol

The posting service:
1. validates the journal schema and exact integer amounts;
2. checks idempotency fingerprint;
3. locks all affected accounts in stable order;
4. verifies account status, currency and exponent configuration;
5. inserts a draft journal header and all lines;
6. marks the journal posted inside the same database transaction;
7. updates account balance projections atomically;
8. checks account normal-balance policy and active reservations;
9. appends the ledger event to the tenant hash chain;
10. commits only if all database and deferred balance constraints pass.

The transaction uses PostgreSQL SERIALIZABLE isolation. Only known serialization failures and deadlocks are retried, with a bounded retry count. Business-rule failures are not retried.

No external provider network call is performed inside the database transaction. Provider calls must use an outbox/inbox workflow with explicit pending, unknown, confirmed, reversed and reconciled states.

## 5. Balance projection and availability

Posted journals and lines are the authoritative accounting facts. keel_ledger_account_balances is a rebuildable projection updated in the same transaction as posting.

The projection records:
- debit total;
- credit total;
- normal-side balance;
- projection version and update time.

The service exposes an independent comparison between the projection and the posted journal lines. A mismatch must be investigated and the projection rebuilt from source journal facts through an authorised repair procedure; it must not be silently accepted.

For reservable accounts:

Available = Normal-side ledger balance − Active reservations

Reservations are separate from posted accounting entries. They:
- reserve a specific account, currency and exact amount;
- require an idempotency key and purpose;
- may expire;
- may be released;
- may be consumed only with a journal that reduces the account's normal balance by exactly the reserved amount.

A reservation is not a payment, settlement or transfer. It is a controlled hold against availability.

## 6. Tenant isolation and evidence

All ledger tables enforce row-level security using transaction-local keel.tenant_id. The runtime database role must not own ledger tables and must not have BYPASSRLS. Production role grants must be least-privilege and separated from migration ownership.

The event stream is per tenant:
- monotonically increasing sequence;
- previous event fingerprint;
- canonical event payload;
- SHA-256 event fingerprint;
- append-only event rows;
- separately stored event head.

The verifier checks event ordering, links, fingerprints and head consistency. This provides tamper-evident evidence, not an absolute guarantee against a privileged database administrator rewriting both data and hashes. Stronger assurance requires independently retained checkpoints, key separation, external anchoring and audit controls.

## 7. API surface in this tranche

The tenant-authenticated ledger API currently supports:
- list and create accounts;
- post a journal;
- retrieve an account balance;
- create, release and consume reservations;
- verify the tenant ledger event hash chain.

The API does not connect to a bank, issuer, payment scheme, ATM, custodian or settlement rail. It is a ledger control API, not a live money-movement API.

## 8. Database and test gates

The ledger verification workflow:
- starts a disposable PostgreSQL 16 instance;
- applies migrations 012 and 013;
- creates a restricted runtime role that is not the table owner and does not have BYPASSRLS;
- runs unit and PostgreSQL integration tests;
- exercises journal posting, idempotency, account balance projections, reservation concurrency, exact reservation consumption, reversals, tenant isolation and event-chain verification.

A passing CI run demonstrates that the tested paths work in that isolated environment. It does not establish production readiness, regulatory approval, independent security assurance, accounting-policy approval or legal enforceability.

## 9. Known gaps before production

The following are explicit next work, not implied capabilities:

1. **Currency master data:** versioned, source-backed ISO 4217 currency definitions and controlled currency-exponent approval.
2. **Book and legal-entity dimensions:** multi-entity accounting books, consolidation boundaries, intercompany controls and entity-specific permissions.
3. **Accounting periods:** period open/close, posting-date control, backdating policy and controlled reopen approvals.
4. **Posting authority:** maker-checker/dual approval, service principals, signing identity and source-system authorisation for high-risk journals.
5. **Reconciliation:** independent provider statement ingestion, matching, suspense management, break ageing and controlled resolution.
6. **Outbox/inbox:** durable provider command/event delivery, retries, deduplication and unknown-outcome handling.
7. **Projection repair:** privileged, evidence-producing rebuild process and scheduled reconciliation against journal facts.
8. **Operational controls:** backup/restore, point-in-time recovery, failover, WAL monitoring, key rotation, disaster recovery and runbooks.
9. **Assurance:** independent accounting review, threat modelling, penetration testing, privacy assessment, performance/load testing and external audit.
10. **Regulatory integration:** jurisdiction-specific chart-of-accounts mapping, reporting, safeguarding, record-retention and access controls.

## 10. Forbidden shortcuts

- Never use JavaScript floating-point values for money.
- Never edit or delete posted journal facts.
- Never infer current available funds from an old balance snapshot.
- Never net different currencies without a separately authorised FX transaction.
- Never treat a reservation, guarantee, claim or pending provider response as settled cash.
- Never bypass tenant RLS with a shared superuser runtime credential.
- Never let AI post journals, approve its own authority or enlarge a reservation mandate.
- Never apply migrations 012/013 to production until the production database, role grants, backup, restore, migration rollback/forward plan and operational gates have been independently reviewed.
- Never describe this tranche as IFRS-certified, ISO-certified, audited, bank-grade or production-ready.

## 11. Acceptance statement

This tranche is a tested engineering foundation for Keel's ledger. It establishes core posting, exact arithmetic, reservation, evidence and tenant-isolation controls. Production financial use remains blocked until the known gaps, regulated-provider integrations, operational controls and independent assurance are completed.
