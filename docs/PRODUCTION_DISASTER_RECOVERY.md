# Keel Disaster Recovery — Production Acceptance Standard

Status: pre-production implementation. This standard is not evidence that production DR is operational.

## Required architecture
- Separate recovery account/project and region with independent administrative credentials.
- Encrypted base backups and continuous WAL archiving to versioned, immutable object storage.
- KMS/HSM-backed key custody, dual-control break-glass access, rotation and revocation tests.
- Archive gap/lag monitoring, backup freshness alerts, retention enforcement and restore sampling.
- Isolated clean-room restore, PITR, signed evidence verification and controlled failover/failback.

## Proposed objectives (not commitments)
RPO 15 minutes and RTO 4 hours are planning targets only. Risk, finance and operations owners must approve them; timed repeated exercises must demonstrate them before publication.

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
1. Fence writers and preserve forensic evidence.
2. Select recovery target timestamp/LSN and document incident cutoff.
3. Restore base backup plus WAL into a new isolated cluster.
4. Run migrations only when the approved recovery plan requires them.
5. Verify tenant isolation, ledger projections, event chains, idempotency, authority records, provider inbox/outbox, holds and signed independent checkpoints.
6. Reconcile every post-target external transaction and callback; quarantine uncertain outcomes.
7. Obtain independent finance-control and recovery-authority approvals.
8. Rehearse traffic cutover, writer fencing, failback and evidence retention.

## Evidence retained
Exercise ID, source/target identities, backup hash/manifest, WAL range and target LSN/time, software/tool versions, operator/approver identities, timestamps, verification output, reconciliation exceptions, measured RPO/RTO and signed decision. Store evidence in immutable custody separate from the production account.

## Cadence
Daily backup/WAL health monitoring; weekly encrypted artifact integrity/decryption verification in recovery environment; monthly isolated restore; quarterly timed regional failover/failback exercise; repeat restore compatibility tests after schema, ledger, authority or provider lifecycle changes.

## Acceptance gates
- [ ] Separate recovery account and region provisioned.
- [ ] Automated encrypted backups land in immutable storage.
- [ ] Continuous WAL archiving, gap detection and alerting proven.
- [ ] KMS/HSM custody and break-glass access tested.
- [ ] RPO/RTO formally approved and demonstrated.
- [ ] Clean-room PITR restore passes.
- [ ] Tenant, ledger, authority, provider and checkpoint invariants pass after restore.
- [ ] External transaction reconciliation and idempotent replay demonstrated.
- [ ] Regional failover and controlled failback rehearsed.
- [ ] Independent security review and signed runbooks complete.

No live financial dispatch or production recovery claim until every gate is evidenced.
