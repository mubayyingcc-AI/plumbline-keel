# Isolated tenant-consistent encrypted backup worker

The dedicated worker creates an encrypted logical package from one exported PostgreSQL `REPEATABLE READ` snapshot. Tenant-keyed tables are exported under each tenant's RLS context using the same snapshot identifier; global tables are exported separately. Per-table/per-tenant row counts are checked before the package can be encrypted or uploaded.

## Required runtime variables

- `DATABASE_URL`: connection URL for the dedicated `keel_backup` login. Never use the application URL, owner, or superuser.
- `KEEL_BACKUP_AGE_RECIPIENT`: public age recipient only. The matching private identity must be held outside Railway by the recovery custodian.
- `KEEL_BACKUP_DATABASE_ID`: stable non-secret source database identifier.
- `KEEL_BACKUP_S3_BUCKET`, `KEEL_BACKUP_S3_ENDPOINT`, `KEEL_BACKUP_S3_REGION`: Railway bucket variable references.
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`: Railway bucket variable references; never paste credential values into Git.
- `KEEL_BACKUP_S3_PREFIX`: optional object prefix, e.g. `keel`.

## Backup coverage and fail-closed policy

The exporter requires the dedicated `keel_backup` login with no superuser, role-creation, database-creation, replication or RLS-bypass privileges. It requires `FORCE ROW LEVEL SECURITY` and a `keel.tenant_id` policy on every tenant-keyed table, a tenant registry foreign key, validated non-null tenant ownership, and no unsupported partitioned/foreign/materialized relations or large objects. Unsupported objects cause a non-zero exit before encryption/upload.

The package contains schema, custom role names and memberships (no password hashes), global rows, one row-data file per tenant, sequence high-water values, per-scope row-count coverage, and a SHA-256 file manifest. Sequence values are captured after the snapshot exports because PostgreSQL sequences are non-transactional; this may advance restored sequences but will not move them backwards.

## Restore

Use `scripts/restore-postgres-encrypted.sh` with the private age identity (mode `0600`) and a new, isolated, empty PostgreSQL 18 database. The script validates the outer checksum and manifest, decrypts to a private temporary directory, rejects unsafe archive paths, validates every package file hash, recreates custom roles without login credentials, restores schema/data/sequences, reassigns the narrow `keel_auth_owner` SECURITY DEFINER functions, and checks every recorded tenant/table row count under the restored backup role's RLS view.

The restore script refuses non-empty targets. It does not restore passwords or turn on application traffic. Provision application credentials and perform application-specific checks separately.

## Scheduling

Configure Railway as a separate cron service only after the full isolated restore workflow passes and the private recovery identity is independently escrowed. The initial operating target is `0 */6 * * *`; it is not a measured RPO. Do not enable the cron while the source role migration, connection URL or restore validation is incomplete.

## Safety controls

- Encryption completes before any remote upload.
- The outer manifest is uploaded last and acts as the remote completion marker.
- The database URL and private recovery identity are never written to backup metadata or logs.
- Do not mount the production PostgreSQL data volume into this worker.
- Do not grant this worker database write privileges.
- Configure deletion-resistant retention and independent bucket administration outside this image.
- Alert on non-zero exit, missing backup heartbeat, checksum mismatch, and backup age threshold.
- This worker performs tenant-aware logical backups. It does not configure WAL archiving or point-in-time recovery.
