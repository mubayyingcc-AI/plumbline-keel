# Keel Global Ledger — Completion and Production Assurance Plan

**Status:** Double-entry posting, book-scoped chart of accounts, effective-dated periods and exact multi-currency trial balance are implemented in the isolated Railway staging environment. This is a staging-validated foundation, not a production-ready global accounting system. Dual-control period close/reopen, durable provider reconciliation, operational recovery and independent assurance remain incomplete.

## Implemented foundation in PR #22 and staging integration PR #27
- Double-entry journal validation, exact integer minor-unit posting, account currency exponent, atomic PostgreSQL posting, SERIALIZABLE retries, immutable posted journals, compensating reversals, idempotency, reservations, account projections, tenant RLS and append-only hash-linked events.
- Tenant-scoped accounting books, book-specific chart-of-account mappings, non-overlapping effective-dated periods, open-period posting gate and accounting-date boundary checks.
- Opening, period movement and closing trial balance by account and currency, using integer minor units and no cross-currency netting.
- Migrations 012, 013 and 014 applied to isolated Railway PostgreSQL 18 staging. The app connects as keel_runtime, without superuser or RLS-bypass privileges; ten ledger/accounting tables have forced tenant RLS.
- Disposable PostgreSQL 16 CI applies all three migrations and exercises restricted-role posting, reservations, book mapping, period controls and trial-balance equality.

No production database migration or external financial settlement is enabled.

## Required accounting layers
1. **Currency master data:** authoritative versioned ISO 4217 source, effective dates, historic changes, redenomination, non-circulating/fund codes, precision and cash rounding. FX rates use decimal/fixed-point with quote direction, source, timestamp, validity, spread and purpose.
2. **Entity and books:** tenant → legal entity → accounting book → chart of accounts; functional/presentation/transaction currencies; control accounts, subledgers, intercompany and consolidation boundaries.
3. **Accounting periods:** planned/open periods and journal date binding are implemented. Still required: fiscal-year/calendar generation, controlled backdating, soft close, dual-control final close, approved reopen and adjustment-period policy.
4. **Trial balance and reporting:** opening/movement/closing balances and per-currency debit-credit proof are implemented for mapped accounts. Still required: suspense/control-account reconciliation, versioned financial-statement mappings, consolidation and reporting basis outputs (IFRS/local GAAP/IPSAS where applicable).
5. **Reconciliation:** a synthetic deterministic matching POC handles exact, duplicate, overstatement, missing, partial, wrong-type and late events. Still required: durable bank/custodian/switch/card/central-bank/settlement ingestion, fee/FX/reversal/out-of-order matching, operator exception workflow and independent source proof. Fuzzy matching suggests only. Unmatched items are never silently adjusted.
6. **Provider lifecycle:** durable outbox/inbox, deduplication, retries, unknown outcomes, confirmation, reversal and reconciliation. Network calls never occur inside ledger DB transactions.
7. **Controls:** restricted runtime identity, tenant RLS and open-period posting gate are implemented. Still required: maker-checker workflows, scoped service authority, suspense write-off approval, dual-control period close/reopen and approval evidence.
8. **Operations:** backups, PITR, restore drills, failover, WAL monitoring, key rotation, DR, alerting, incident response and load/fault testing.
9. **Assurance:** independent accounting, database, security, privacy, penetration, concurrency and operational review.

## Required acceptance tests
Currency 0/2/3/6 decimals and historic changes; multi-currency separation; concurrent posting/reservation; idempotent and conflicting replay; exact reversal; non-open/out-of-range period rejection; chart-of-account mapping; exact trial balance per currency; period close dual-control and authorised reopen; statement duplicates/missing/late/partial/FX; cross-tenant RLS; projection rebuild/tamper; backup restore and deterministic replay.

## Release rule
Do not apply migrations to production, connect live funds or enable financial execution until full schema/API review, disposable PostgreSQL CI, staging migration/rollback and restore drills, signed provider/legal evidence contracts, and independent accounting/security/operational approval pass.
