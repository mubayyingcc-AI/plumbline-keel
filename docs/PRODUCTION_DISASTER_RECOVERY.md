# Keel Production Disaster Recovery Standard

**Status: implementation foundation; not production-approved.** The encrypted backup scripts are executable controls. Cloud custody, continuous WAL archiving, PITR, cross-region failover, monitoring and a witnessed recovery exercise still require deployment-specific implementation and evidence.

## 1. Proposed recovery objectives

These are engineering targets for review, not approved service commitments.

| Measure | Proposed target | Proof |
| --- | --- | --- |
| RPO | 15 minutes | Measured WAL archive lag and recovered commit watermark |
| RTO | 4 hours | Timed end-to-end isolated recovery exercise |
| Backup cadence | Daily base backup plus continuous WAL | Scheduler and archive continuity monitor |
| Retention | 35 daily and 12 monthly recovery points | Object lifecycle policy and restore sampling |
| Integrity | Encrypted, checksummed, manifest-bound and restore-tested | Independent checksum, decrypt and restore evidence |

Do not advertise these targets until business, risk and operations owners approve them and repeated timed exercises demonstrate them. A financial institution may require tighter objectives.

## 2. Failure domains and recovery order

1. Application/process failure: redeploy a known-good immutable artifact; do not mutate financial state as a shortcut.
2. Database host/volume loss: provision a clean database, restore a verified base backup, replay WAL to a selected recovery point, then run all integrity checks.
3. Logical corruption or malicious writes: fence the writer, preserve forensic evidence, identify a pre-corruption point, restore separately and reconcile all transactions after that point.
4. Credential/signing-key compromise: revoke the compromised identity, preserve evidence, rotate credentials under independent control, and require fresh authority approvals before reopening consequential actions.
5. Region/provider outage: activate a separately administered recovery environment. A second application replica is not a DR site.
6. Evidence-store loss: recover checkpoints/manifests from independent immutable custody and verify signatures and event-chain heads.

## 3. Encrypted backup

Run `scripts/backup-postgres-encrypted.sh` with:

- `DATABASE_URL`: restricted operational connection.
- `KEEL_BACKUP_DIR`: private local staging directory.
- `KEEL_BACKUP_AGE_RECIPIENT`: public age recipient; private identity must not be on the database host.
- `KEEL_BACKUP_DATABASE_ID`: stable non-secret database identifier.

The script creates a PostgreSQL custom-format dump, encrypts it with age, verifies decryptability, and writes a SHA-256 sidecar plus a metadata manifest. It does **not** upload artifacts. Transfer the encrypted backup, manifest and checksum to a separate account/project with object versioning, retention lock/WORM, deletion protection, MFA, audit logging and separately administered credentials. A backup stored only beside the source is not DR.

Hold the age identity outside the production account using managed KMS/secrets custody, dual control, recovery escrow and tested revocation. Never place it in Git, CI logs, application variables or the backup storage account.

## 4. WAL and point-in-time recovery

Logical `pg_dump` is not continuous recovery. Production PostgreSQL must use a supported physical backup/WAL tool such as pgBackRest or WAL-G, configured for:

- `archive_mode=on` and a tested `archive_command` with non-zero failure propagation;
- continuous WAL upload to a separate encrypted, versioned object store;
- base backups on a documented cadence;
- archive verification, retention and gap detection;
- a restore target timestamp/LSN recorded in the incident ticket;
- alerts for archive lag, failed uploads, expired credentials, missing segments and backup age.

Choose the tool, store, region, encryption key, retention and topology for the actual hosting environment. Do not paste a generic archive command into production: it must be idempotent, safely quote paths, retry and fail visibly when storage is unavailable. Restore PITR into a new isolated cluster, confirm the target timestamp/LSN, then run recovery verification.

## 5. Controlled restore

`scripts/restore-postgres-encrypted.sh` requires explicit confirmation, validates the checksum, decrypts using an externally supplied age identity, refuses a target containing user tables/views, validates the archive and restores without ownership/ACL changes.

Example using a newly provisioned empty database:

```bash
export KEEL_BACKUP_FILE=/secure/recovery/keel-backup.dump.age
export KEEL_BACKUP_AGE_IDENTITY_FILE=/secure/recovery/age-identity.txt
export KEEL_RESTORE_DATABASE_URL='postgresql://restore_operator@recovery-host/keel_restore'
export KEEL_RESTORE_CONFIRM=RESTORE_TO_EMPTY_DATABASE
bash scripts/restore-postgres-encrypted.sh
```

After restore:
1. Run migrations only if the recovery plan explicitly requires them; never blindly migrate a restored production database.
2. Run `node scripts/verify-recovery-state.js` with the isolated recovery environment and least-privilege runtime role.
3. Verify tenant isolation, ledger projections, event-chain integrity, idempotency, authority envelopes/approvals, provider inbox/outbox and pending holds.
4. Verify the latest independently signed checkpoint; explain any difference between checkpoint time and restore target.
5. Reconcile transactions, callbacks and external statements after the recovery point. Quarantine ambiguous outcomes; never auto-post settlements to force alignment.
6. Obtain independent financial-control and recovery-authority approval before routing traffic or enabling consequential actions.

## 6. Keel invariants

- Tenant boundaries remain enforced by database policy and restricted runtime roles.
- Ledger history remains append-only; never repair balances with direct row edits.
- Projections are reproducible from authoritative events.
- Authority envelopes, approvals, key IDs and action proofs remain linked and verifiable.
- Provider callbacks/outbox replay is idempotent and cannot bypass KAAA or create duplicate settlement.
- Holds and uncertain outcomes remain held until independently reconciled.
- Recovery operators cannot approve their own elevated financial actions.
- AI recommendations are not recovery authorization.

## 7. Exercise schedule and evidence

- Daily: monitor last successful base backup, WAL lag and object-store failures.
- Weekly: verify a sampled backup checksum and decryptability without exposing plaintext.
- Monthly: restore a random recovery point in isolation and run full recovery verification.
- Quarterly: timed regional recovery exercise including application redeploy, PITR, tenant isolation, ledger reconciliation, authority/key checks and cutover rehearsal.
- After schema, ledger, authority or provider lifecycle changes: restore compatibility exercise.

Retain immutable evidence: exercise ID, source/target database identities, backup manifest/hash, WAL start/end and target LSN/time, tool versions, operator/approver identities, timestamps, test results, reconciliation exceptions, measured RPO/RTO and signed completion decision.

## 8. Failback

Failback is a separate controlled change. Confirm the recovered primary is authoritative, fence writers at the failed site, reconcile post-recovery external activity, verify replication direction/lag, obtain two-person approval, then route traffic. Never permit two writable primaries for the same tenant/ledger domain.

## 9. Production acceptance gates

- [ ] Separate recovery account/project and region provisioned.
- [ ] Encrypted backups automatically uploaded to immutable/versioned storage.
- [ ] WAL archiving and gap/lag alerting operational.
- [ ] KMS/HSM or equivalent key custody, rotation and break-glass tested.
- [ ] RPO/RTO approved by business, risk and operations owners.
- [ ] Clean-room PITR restore from base backup plus WAL passes.
- [ ] Tenant, ledger, authority, provider and checkpoint checks pass after restore.
- [ ] External transaction reconciliation and safe replay demonstrated.
- [ ] Regional failover and controlled failback rehearsed.
- [ ] Independent security review and signed runbooks complete.

Until all gates are evidenced, Keel remains pre-production. Do not enable live financial dispatch or represent a CI logical restore as production disaster recovery.
