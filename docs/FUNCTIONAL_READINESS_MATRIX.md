# Plumbline Keel — Functional Readiness Matrix

**Evidence snapshot:** 24 November 2026  
**Main commit:** `311fee87e058ea0ac1eb60d5f9949844fcb69c07`  
**Release decision:** **NOT READY FOR PRODUCTION**

This matrix distinguishes code and CI evidence from live deployment, external-provider certification, and production-operational proof. A passing automated workflow proves only the behavior it exercises; it does not certify the whole financial platform.

## 1. Capability status

| Capability | Current implementation and evidence | Remaining acceptance work |
|---|---|---|
| Double-entry ledger | Journal posting, minor-unit arithmetic, idempotency, reversals, reservations and ledger verification are implemented. PostgreSQL 16 and 18 integration workflows pass. | Deploy latest main to staging; run authenticated API smoke tests against the actual staging runtime role; independent accounting-policy review. |
| Accounting books and periods | Books, period state, close controls and trial-balance foundations exist in the database and code. | Verify period opening/closing, dual-control separation, trial-balance cut-offs and immutable close evidence on the live staging database; obtain accounting sign-off. |
| Tenant security | Tenant authentication, transaction-local tenant context, forced RLS, direct tenant foreign keys and readiness inventory are implemented. PostgreSQL 16/18 checks pass. | Verify the deployed runtime identity, role memberships, object ownership, grants and all tenant routes on the current staging build; independent penetration test. |
| Provider lifecycle | Durable outbox/inbox lifecycle, callback signature verification, idempotency, dispatch authority and reconciliation foundations exist. | Current adapter is a sandbox implementation. Real bank, MTO, wallet, card-processor and issuer integrations, provider sandbox certification, operational keys and callback testing remain outstanding. |
| Reconciliation | Deterministic matching and exception handling are implemented for the supported event model. | Real provider statements, settlement files, delayed/duplicate callbacks, reversals, chargebacks and operational exception ownership must be tested with certified partners. |
| Payment authority | Deterministic authority and action-proof controls exist. The product remains non-executing outside its supported sandbox path. | Real execution requires signed mandates, delegated authority, limit enforcement, dual approval, provider-side idempotency and independently tested recovery. |
| AI release assurance | Tenant-scoped assessment API and evidence persistence foundations exist. | Connect to real model, prompt, retrieval, tool and policy version identifiers; prove pre-release approval and post-release rollback/hold behavior in a customer-like staging workflow. |
| Collateral and position assurance | Financial-core and evidence foundations exist. | No verified external custodian, registry, ownership, lien, encumbrance or reuse/rehypothecation integrations are evidenced. Do not claim collateral verification until those integrations and legal controls exist. |
| Cards and consumer identity | The consumer/card APIs deliberately fail closed while tenant ownership is not fully enforced. | Keep disabled until tenant ownership, pairing, issuer/processor integration, card lifecycle, disputes and regulatory controls pass their own acceptance suite. |
| Risk and scenario models | Deterministic synthetic scenarios and model foundations exist. | Real market/data feeds, calibrated assumptions, validation, model governance and jurisdiction-specific regulatory review remain outstanding. |
| Backup and recovery | Encrypted tenant snapshot, RLS-aware backup identity, complete backup-role membership audit, isolated restore and S3-backed PostgreSQL 18 PITR workflows pass in CI. | Deploy the fixed backup worker to staging; verify real remote artifact listing, retrieval, decryption and isolated restore from the actual staging bucket; run a documented production restore/PITR drill. |
| Security and operations | Public readiness diagnostics are redacted; detailed diagnostics require an internal token. Oversized signed-body handling and bounded proxy-aware rate limiting are covered by tests. | Rate limiting is process-local, not distributed. Add shared rate-limit state before horizontal scaling; complete SSO/MFA decisions, secrets rotation, independent penetration test, incident runbooks and monitoring. |

## 2. Deployment evidence

### Staging

- The verified staging web service has a restricted runtime database URL and TLS CA configuration.
- Its last successful deployment is still pinned to old commit `8c9e074286b17eb1e1e294008312952f7de09203` (13 November), not current main.
- The staging backup worker still points to branch `deploy/keel-staging-backup-worker` and old commit `354d8cd1d593ff4802ada5c18238e29dae35f214`.
- Railway patch `5160696a-1c34-4cc3-a60f-277b56392a4c` is staged, non-destructive and not deployed. It changes both the verified staging app and backup worker to follow `main`.
- The failed/quarantined staging service on `security/global-financial-core-tenant-assurance` is intentionally untouched.

### Production

- The production web service is Online, but its configured variable names include only `DATABASE_URL`; `KEEL_RUNTIME_DATABASE_URL` and `PGSSLROOTCERT_B64` are absent.
- No production healthcheck path is configured.
- The last production web deployment is 10 November and does not prove the current restricted runtime database contract.
- The production PostgreSQL service being Online does not prove the web service uses a least-privilege runtime identity.
- The production DR worker is still staged-create, not deployed.

**Therefore production database-backed functionality is not evidenced as operational.** Do not copy the admin `DATABASE_URL` into the runtime variable or disable TLS verification as a workaround.

## 3. Current automated evidence

The merged mainline candidate passed:

- Application CI
- PostgreSQL 16 and PostgreSQL 18 ledger verification
- Backup-role and nested-membership tests
- Tenant-consistent encrypted snapshot round-trip into an isolated PostgreSQL 18 restore
- Backup worker image build
- Encrypted backup/restore
- S3-backed PostgreSQL 18 point-in-time recovery

These workflows are valuable automated evidence, not a substitute for a live staging smoke test, real partner certification, independent financial/security review or production cutover.

## 4. Required release gates

Production promotion remains blocked until all applicable gates are evidenced:

1. Deploy the exact reviewed main SHA to the verified staging app and backup worker.
2. Verify startup, health, migrations, TLS and the actual `keel_runtime` identity.
3. Run tenant-isolation positive and negative tests across every sensitive API and database route.
4. Exercise end-to-end journal, reservation, accounting-period, provider callback, reconciliation and evidence workflows on staging.
5. Verify backup artifacts in the real staging object store, then retrieve, decrypt and restore them in an isolated database.
6. Complete independent accounting, security and operational reviews.
7. Provision a dedicated production runtime login, verified TLS CA and healthcheck under a separately approved production cutover plan.
8. Run production backup/restore and rollback/forward-recovery drills before enabling financial execution.
9. Obtain real provider certification before describing external settlement, card issuance or remittance as live.

## 5. Release rule

Any missing, stale, inaccessible or unverified evidence is **UNKNOWN**, not PASS. A successful CI workflow does not authorize a production release. Production remains **BLOCKED** until the relevant gates above pass on the exact deployed build and a separate change approval is recorded.
