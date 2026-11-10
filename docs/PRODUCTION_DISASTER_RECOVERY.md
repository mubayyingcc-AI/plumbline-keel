# Keel Disaster Recovery — Production Acceptance Standard

Status: pre-production implementation; not proof that production DR is operational.

## Implemented tooling
- `scripts/backup-postgres-encrypted.sh` creates a custom-format PostgreSQL dump, encrypts it client-side with an age recipient, writes a SHA-256 sidecar and identity-bound manifest, and can upload all three artifacts to an S3-compatible destination.
- Remote upload requires `KEEL_BACKUP_S3_BUCKET`, `KEEL_BACKUP_S3_ENDPOINT` (HTTPS outside isolated CI), `KEEL_BACKUP_S3_REGION`, and AWS-compatible credentials in `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.
- `scripts/restore-postgres-encrypted.sh` requires a clean target, explicit confirmation, expected source database identity, mode-0600 decryption identity, valid checksum and manifest, and a matching recipient fingerprint before restoring.
- `scripts/ci-pgbackrest-pitr.sh` plus the dedicated CI job exercise full backup, WAL archiving and named point-in-time restore against disposable S3-compatible storage. A passing CI test is not a production configuration.

## Required architecture
- Separate recovery account/project and region with independent administration.
- Encrypted base backups and continuous WAL archiving to versioned immutable object storage.
- KMS/HSM-backed key custody, dual-control break-glass access, rotation and revocation tests.
- Archive gap/lag monitoring, backup freshness alerts, retention enforcement and restore sampling.
- Isolated clean-room restore, PITR, signed evidence verification and controlled failover/failback.

## Proposed objectives (not commitments)
RPO 15 minutes and RTO 4 hours are planning targets only. Risk, finance and operations owners must approve them and timed repeated exercises must demonstrate them.

## Keel recovery invariants
1. Tenant isolation and restricted database roles survive restoration.
2. Ledger events remain authoritative and append-only; never repair balances with direct edits.
3. Rebuild projections from authoritative events and verify chain/checkpoint integrity.
4. Preserve authority envelopes, independent approvals, key identifiers and action proofs.
5. Provider inbox/outbox replay remains tenant-bound and idempotent; no automatic settlement posting.
6. Ambiguous external outcomes remain held until reconciled against provider/bank evidence.
7. Recovery operators cannot approve their own elevated actions.
8. AI suggestions never authorize recovery or financial execution.

## Exercise sequence
Fence writers; preserve forensic evidence; select recovery timestamp/LSN; restore base backup plus WAL into a new isolated cluster; run migrations only when the approved plan requires them; verify tenant isolation, ledger projections, event chains, idempotency, authority records, provider inbox/outbox, holds and signed checkpoints; reconcile all post-target external transactions; quarantine uncertain outcomes; obtain independent finance-control and recovery-authority approval; rehearse traffic cutover, writer fencing and failback.

## Evidence
Retain exercise ID, source/target identities, backup hash/manifest, WAL range and target LSN/time, tool versions, operator/approver identities, timestamps, verification output, reconciliation exceptions, measured RPO/RTO and signed decision in immutable custody separate from production.

## Cadence
Daily backup/WAL health monitoring; weekly encrypted artifact integrity/decryption verification in recovery environment; monthly isolated restore; quarterly timed regional failover/failback; repeat compatibility restore after schema, ledger, authority or provider lifecycle changes.

## Acceptance gates
- [ ] Separate recovery account and region provisioned.
- [ ] Automated encrypted backups land in immutable storage.
- [ ] Continuous WAL archiving, gap detection and alerting proven.
- [ ] KMS/HSM custody and break-glass access tested.
- [ ] RPO/RTO formally approved and demonstrated.
- [ ] Clean-room PITR restore passes.
- [ ] Tenant, ledger, authority, provider and checkpoint invariants pass.
- [ ] External transaction reconciliation and idempotent replay demonstrated.
- [ ] Regional failover and controlled failback rehearsed.
- [ ] Independent security review and signed runbooks complete.

No live financial dispatch or production recovery claim until every gate is evidenced.
