# Production cutover and recovery release gates

**Status reviewed:** 2026-11-11  
**Scope:** Plumbline Keel application, PostgreSQL 18, tenant isolation, backup and recovery.

This document is an operational release gate, not a claim of certification or production readiness.

## Verified deployment inventory

- Railway production environment currently has one web replica in `us-west2`.
- PostgreSQL 18 is a single service with a 5 GB persistent volume in `us-west2`; no database replica or regional failover was observed.
- The currently deployed web commit is `e124812c384b659fbc1176b48f7e97f85ef1cb31`.
- The current application source on `main` enforces the restricted `keel_runtime` login through `KEEL_RUNTIME_DATABASE_URL`.
- The live web service's observed variable names include `DATABASE_URL`, but not `KEEL_RUNTIME_DATABASE_URL`.
- The production migration runner explicitly refuses non-staging execution unless a separately reviewed production migration path is implemented.
- The isolated backup worker exists only as a staged Railway service. It has no database URL, no deployed image, and no active cron schedule.
- The worker's current script still performs a whole-database `pg_dump`; it is not yet a tenant-partitioned, snapshot-consistent export.
- CI has demonstrated encrypted synthetic PostgreSQL 18 backup/restore to a disposable S3-compatible endpoint. This does not establish a production backup.
- PostgreSQL 18 PITR remains a release gate until the named/LSN restore-point assertions pass in CI and are separately validated against a production-equivalent configuration.

## Hard release gates

### 1. Database authority and schema

- [ ] Inventory production schema, table counts, tenant ownership, null-tenant legacy rows, extensions, sequences, constraints and triggers.
- [ ] Create and verify the least-privilege `keel_runtime` login; no superuser, database creation, role creation or RLS bypass.
- [ ] Apply reviewed schema migrations under a controlled change window, with a verified pre-change recovery point.
- [ ] Confirm every tenant-keyed table has enabled and forced RLS and a valid tenant policy.
- [ ] Confirm the application connection uses only `keel_runtime`; no fallback to the database owner.
- [ ] Run ledger balance, immutability, event-chain, period-close and cross-tenant negative tests against the migrated database.

### 2. Backup and recovery

- [ ] Decide and document the complete backup model: physical/WAL recovery, or a logical export with explicit global and tenant-scoped data handling.
- [ ] A tenant-scoped logical export must use one exported MVCC snapshot for schema/data inventory and every tenant partition. It must fail closed on unclassified tables, unsupported partitioning, large objects, sequence ownership or RLS gaps.
- [ ] Preserve required schema objects, role/ownership semantics, sequence state, extensions, constraints and triggers.
- [ ] Encrypt before upload; verify artifact digest, manifest identity and encryption recipient.
- [ ] Use independent storage credentials and deletion-resistant retention.
- [ ] Restore into a separate empty PostgreSQL 18 instance, reapply role and ownership boundaries, validate constraints and run tenant/ledger integrity assertions.
- [ ] Record actual backup/restore duration and measured RPO/RTO. Do not infer them from a six-hour schedule.
- [ ] Only then activate the worker schedule and alert on missed backups, upload failures, age thresholds and restore-test failures.

### 3. Application release

- [ ] Set `KEEL_RUNTIME_DATABASE_URL` to the verified restricted runtime login; do not point it at the owner URL.
- [ ] Confirm `GET /api/health` reports database connected and configure Railway's deploy healthcheck to use that endpoint.
- [ ] Deploy the reviewed commit only after migration and role checks pass.
- [ ] Smoke-test tenant bootstrap, authentication, tenant isolation, ledger posting, duplicate idempotency, period controls, provider inbox/outbox and recovery endpoints.
- [ ] Verify no live provider dispatch or settlement is enabled unintentionally.
- [ ] Confirm rollback procedure and compatibility of application rollback with forward-only database migrations.

### 4. Operational assurance

- [ ] Add production request/error metrics, database saturation/connection alerts, structured audit log retention and trace correlation.
- [ ] Review secrets, key rotation, TLS verification, egress controls and backup credential separation.
- [ ] Establish a second failure domain for database recovery and test regional restoration.
- [ ] Complete independent penetration testing and financial-controls review before external financial-institution production use.
- [ ] Obtain provider/bank certification for any real financial rail. Synthetic adapters are not certification.

## Current release decision

**Do not promote the current `main` application to the existing production web service yet.** Its restricted runtime connection is not configured in the observed Railway environment, and the required production migration has not been applied or verified.

**Do not activate the backup worker yet.** The worker is staged only, lacks a database identity, and its current whole-database dump does not satisfy the intended tenant-RLS backup design.

The next safe sequence is: verified pre-change recovery point → reviewed production migration and role provisioning → runtime URL cutover → application deployment and smoke tests → complete backup/restore validation → scheduled backup activation.

No financial execution, settlement, or production database mutation is authorized by this runbook.
