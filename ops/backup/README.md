# Isolated encrypted backup worker

This image is intended for a dedicated Railway cron service, separate from the web process and database container.

## Required runtime variables

- `DATABASE_URL`: reference the PostgreSQL service's application connection URL. Use a least-privilege backup role with CONNECT and the minimum SELECT/LOCK privileges required by pg_dump; do not use the superuser for routine exports.
- `KEEL_BACKUP_AGE_RECIPIENT`: public age recipient only. The matching private identity must be held outside Railway by the recovery custodian.
- `KEEL_BACKUP_DATABASE_ID`: stable non-secret identifier for the source database.
- `KEEL_BACKUP_S3_BUCKET`: Railway bucket's actual S3 bucket-name variable reference.
- `KEEL_BACKUP_S3_ENDPOINT`: Railway bucket endpoint variable reference.
- `KEEL_BACKUP_S3_REGION`: Railway bucket region variable reference.
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`: Railway bucket variable references; never paste credential values into Git.
- `KEEL_BACKUP_S3_PREFIX`: optional object prefix, e.g. `keel`.

## Scheduling

Configure the service as a Railway cron job with `0 */6 * * *` only after the required variables are present, the age private identity is independently escrowed, and the bucket upload/restore test has passed. The job exits after one backup. A six-hour schedule is an initial operating target, not a measured RPO.

## Safety controls

- Encryption occurs before any remote upload.
- The database URL is not written to backup metadata or logs.
- Do not mount the production PostgreSQL data volume into this worker.
- Do not grant this worker database write privileges.
- Configure deletion-resistant retention and independent bucket administration outside this image.
- Alert on non-zero exit, missing backup heartbeat, checksum mismatch, and backup age threshold.
- This worker performs logical backups only. It does not configure WAL archiving or point-in-time recovery.

## Deployment

Use Dockerfile path `ops/backup/Dockerfile` with repository root as build context. Set the cron schedule only after configuration and an end-to-end restore test. The Railway service must not start before all required variables are supplied.
