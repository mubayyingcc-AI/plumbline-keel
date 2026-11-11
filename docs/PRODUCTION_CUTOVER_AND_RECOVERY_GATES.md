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
- The main branch now contains a tenant-aware logical backup exporter using one exported MVCC snapshot, tenant-scoped RLS exports, global-data classification, coverage assertions, encrypted packaging and isolated restore checks. The Railway worker remains staged and has not produced a production backup.
- CI has passed encrypted synthetic PostgreSQL 18 backup/restore, tenant snapshot/isolated restore, PostgreSQL 16/18 ledger restore verification and PostgreSQL 18 S3-backed PITR restore-point assertions. These tests use disposable infrastructure and do not establish a production backup or prove production RPO/RTO.

## Hard release gates

### 1. Database authority and schema

- [ ] Inventory production schema, table counts, tenant ownership, null-tenant legacy rows, extensions, sequences, constraints and triggers.
- [ ] Create and verify the least-privilege `keel_runtime` login; no superuser, database creation, role creation or RLS bypass.
- [ ] Apply reviewed schema migrations under a controlled change window, with a verified pre-change recovery point.
- [ ] Confirm every tenant-keyed table has enabled and forced RLS and a valid tenant policy.
- [ ] Confirm the application connection uses only `keel_runtime`; no fallback to the database owner.
- [ ] Run ledger balance, immutability, event-chain, period-close and cross-tenant negative tests against the migrated database.

### 2. Backup and recovery

- [x] Implement a documented logical export model with a shared exported MVCC snapshot and explicit global/tenant data handling.
- [x] Fail closed on unclassified tables and tenant coverage gaps; preserve schema, sequences and required database objects in the synthetic restore harness.
- [x] Encrypt before upload; verify artifact digest, manifest identity and encryption recipient in CI.
- [x] Verify isolated restore, tenant separation and ledger projections in PostgreSQL 16/18 CI.
- [ ] Provision the production `keel_backup` identity and password out-of-band, store a restricted connection in Railway and run a real production backup.
- [ ] Use independent production storage credentials and retention controls; verify deletion resistance.
- [ ] Record actual production backup/restore duration and measured RPO/RTO.
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
- [ ] Review secrets, key rotation, TLS verification, egress controls and backup credential separation. The application TLS hardening PR must be merged and deployed before production database traffic is considered protected by certificate verification.
- [ ] Establish a second failure domain for database recovery and test regional restoration.
- [ ] Complete independent penetration testing and financial-controls review before external financial-institution production use.
- [ ] Obtain provider/bank certification for any real financial rail. Synthetic adapters are not certification.


### 5. AI release assurance (cross-industry)

- [x] Add a vendor-neutral deterministic assessment core covering model, prompt, retrieval, dataset, tool, agent, workflow, policy, runtime and integration changes.
- [x] Bind release assessments to component fingerprints, required checks, evidence references and timestamps; fail closed on missing, failed, not-run, waived or incomplete required evidence.
- [x] Require scoped independent approval and tested rollback evidence for high- and critical-risk changes.
- [ ] Add tenant-authenticated enterprise API endpoints and persistent, append-only release records with independent proof verification.
- [ ] Authenticate CI and workload evidence producers (OIDC or signed attestations); do not trust caller-supplied evidence URLs or hashes without provenance verification.
- [ ] Deliver at least one production-grade CI adapter and one AI inventory/model-registry adapter, with replay protection, idempotency, key rotation and negative tests.
- [ ] Add policy versioning, exception expiry, reviewer separation-of-duties, evidence retention and audit export.
- [ ] Add post-release observation, model/prompt/tool drift detection, incident linkage and verified rollback orchestration. Keep deployment execution outside the core until an explicit customer-controlled integration is approved.
- [ ] Complete independent application security assessment and enterprise tenant-isolation testing before accepting confidential model or customer data.

## Current release decision

**Do not promote the current `main` application to the existing production web service yet.** Its restricted runtime connection is not configured in the observed Railway environment, and the required production migration has not been applied or verified.

**Do not activate the backup worker yet.** The worker is staged only and lacks the production `keel_backup` database identity/connection. The exporter and CI restore tests are implemented, but no production backup or witnessed production recovery drill exists.

The next safe sequence is: verified pre-change recovery point → reviewed production migrations and least-privilege role provisioning → runtime URL/TLS cutover → application deployment and smoke tests → production backup/restore drill with measured RPO/RTO → scheduled backup activation. In parallel, build the tenant-authenticated AI release API and evidence-provider adapters before marketing this as an enterprise-integrated product.

No financial execution, settlement, or production database mutation is authorized by this runbook.
