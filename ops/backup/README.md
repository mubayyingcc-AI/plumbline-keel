# Tenant-aware encrypted PostgreSQL backup worker

This image is intended for a dedicated Railway cron service, separate from the web process and database container. It uses PostgreSQL 18 client tools and a dedicated keel_backup login that cannot bypass row-level security.

## Required database migrations and role setup

Apply these migrations through the approved database migration process before enabling the worker:

1. db/migrations/020_rls_aware_backup_identity.sql
2. db/migrations/021_backup_tenant_integrity_audit.sql

Provision the keel_backup login password out-of-band using the database administrator's secure password workflow. Do not put the password in Git, logs, or this document. The worker must connect as keel_backup, not as the web application's owner or a superuser.

Migration 021 creates a dedicated NOLOGIN BYPASSRLS audit owner. It owns one fixed SECURITY DEFINER function that returns only counts of NULL-tenant and orphaned-tenant rows. The backup login cannot inherit or assume this audit role. The worker refuses to run while either count is non-zero.

## Required runtime variables

- DATABASE_URL: connection URL for the dedicated keel_backup login.
- KEEL_BACKUP_AGE_RECIPIENT: public age recipient only. The matching private identity must be held outside Railway by the recovery custodian.
- KEEL_BACKUP_DATABASE_ID: stable non-secret identifier for the source database.
- KEEL_BACKUP_S3_BUCKET: Railway bucket's actual S3 bucket-name variable reference.
- KEEL_BACKUP_S3_ENDPOINT: Railway bucket endpoint variable reference.
- KEEL_BACKUP_S3_REGION: Railway bucket region variable reference.
- AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY: Railway bucket variable references; never paste credential values into Git.
- KEEL_BACKUP_S3_PREFIX: optional object prefix, e.g. keel.

## Backup format and safety behaviour

The worker exports one PostgreSQL REPEATABLE READ snapshot and imports that same snapshot for schema, global data, every tenant's data and the per-table row-count manifest. It enumerates tenant IDs through the fixed keel_backup_tenant_ids() function, then runs one RLS-enabled pg_dump --inserts per tenant.

The package includes:

- Public schema objects, indexes, constraints, triggers and RLS policies.
- Global-table data, exported once.
- Tenant-table data, exported separately under each tenant's RLS context.
- Tenant IDs and per-tenant/global row counts tied to the exported snapshot.
- Sequence high-water marks captured after data export to avoid sequence regression.
- Extension names/versions, fixed role bootstrap SQL, and ownership restoration for approved SECURITY DEFINER functions.
- Per-file SHA-256 digests, an internal package manifest, an external artifact manifest, and age encryption.

The worker fails closed if it finds unsupported schemas, non-public data relations, foreign/materialized relations, unprotected or unrecognized tenant RLS policies, unknown SECURITY DEFINER owners, NULL tenant IDs, or orphan tenant references. It does not fall back to a whole-database pg_dump.

## Isolated restore

Use scripts/restore-postgres-tenant-snapshot.sh only against a newly created, isolated, empty restore database. The script:

1. Verifies the external checksum, database identity, age recipient fingerprint and artifact manifest.
2. Rejects unsafe archive paths, links and file types before extraction.
3. Verifies every package file against its digest and exact file set.
4. Checks that the target can create the required roles and that required extension versions are available.
5. Recreates fixed application roles without exporting or setting passwords.
6. Restores schema and ACLs, reassigns approved SECURITY DEFINER functions to non-login owners, then restores global data, tenant data and sequence state.
7. Compares every restored tenant/global table row count with the common-snapshot manifest, verifies tenant identity coverage, checks forced RLS, role boundaries and tenant-integrity audit results.

After restore, provision fresh login passwords and application connection variables out-of-band. Run the ledger/recovery verifier against the isolated target and retain the verification report.

Example required restore environment:

- KEEL_BACKUP_FILE: downloaded .age artifact.
- KEEL_BACKUP_AGE_IDENTITY_FILE: offline recovery identity file with mode 0600.
- KEEL_RESTORE_DATABASE_URL: administrator connection to the isolated empty target.
- KEEL_RESTORE_CONFIRM=RESTORE_TO_EMPTY_DATABASE.
- KEEL_RESTORE_EXPECTED_DATABASE_ID: exact source database ID.

Never point the restore script at the live production database.

## Scheduling and retention

Configure the service as a Railway cron job with 0 */6 * * * only after:

- Both migrations are applied and the live backup role is verified.
- A real encrypted upload to the production bucket succeeds.
- A fresh isolated PostgreSQL 18 restore passes row-count, tenant isolation, RLS, role and ledger verification.
- The private age identity is independently escrowed.
- Bucket retention, deletion resistance, access controls and alerting are configured.

A six-hour schedule is an initial operating target, not a measured RPO. Alert on non-zero exit, missing backup heartbeat, checksum mismatch, and backup-age threshold. Keep an independent recovery copy outside the primary Railway project.

This logical backup worker is separate from pgBackRest WAL archiving/PITR. A successful logical restore does not replace a witnessed PITR drill.
