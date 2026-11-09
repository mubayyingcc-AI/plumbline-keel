# Keel Global Ledger — Completion and Production Assurance Plan

**Status:** Transactional posting foundation under draft review; accounting and operational layers remain incomplete.

## Implemented foundation in PR #22
Double-entry journal validation, exact integer minor-unit posting, account currency exponent, atomic PostgreSQL posting, SERIALIZABLE retries, immutable posted journals, full compensating reversals, idempotency, reservations, projections, tenant RLS and append-only hash-linked events. Verified previously on disposable PostgreSQL 16; not production-deployed.

## Required accounting layers
1. **Currency master data:** authoritative versioned ISO 4217 source, effective dates, historic changes, redenomination, non-circulating/fund codes, precision and cash rounding. FX rates use decimal/fixed-point with quote direction, source, timestamp, validity, spread and purpose.
2. **Entity and books:** tenant → legal entity → accounting book → chart of accounts; functional/presentation/transaction currencies; control accounts, subledgers, intercompany and consolidation boundaries.
3. **Accounting periods:** entity/book calendars, time zones, fiscal years, planned/open/soft-close/closed/reopened states, backdating, controlled adjustments and maker-checker reopen.
4. **Trial balance and reporting:** opening/movement/closing balances, debit-credit proof, suspense/control checks, versioned statement mappings, reporting basis (IFRS/local GAAP/IPSAS where applicable).
5. **Reconciliation:** bank/custodian/switch/card/central-bank/settlement ingestion; exact matching and exception workflow for partial, duplicate, missing, late, reversed, fee, FX and out-of-order events. Fuzzy matching suggests only. Unmatched items are never silently adjusted.
6. **Provider lifecycle:** durable outbox/inbox, deduplication, retries, unknown outcomes, confirmation, reversal and reconciliation. Network calls never occur inside ledger DB transactions.
7. **Controls:** maker-checker, service identities, scoped authority, suspense write-off approval, period close/reopen approval, least privilege, tenant RLS.
8. **Operations:** backups, PITR, restore drills, failover, WAL monitoring, key rotation, DR, alerting, incident response and load/fault testing.
9. **Assurance:** independent accounting, database, security, privacy, penetration, concurrency and operational review.

## Required acceptance tests
Currency 0/2/3 decimals and historic changes; multi-currency separation; concurrent posting/reservation; idempotent and conflicting replay; exact reversal; closed-period rejection; authorised reopen; trial balance to control accounts; statement duplicates/missing/late/partial/FX; cross-tenant RLS; projection rebuild/tamper; backup restore and deterministic replay.

## Release rule
Do not apply migrations to production, connect live funds or enable financial execution until full schema/API review, disposable PostgreSQL CI, staging migration/rollback and restore drills, signed provider/legal evidence contracts, and independent accounting/security/operational approval pass.
