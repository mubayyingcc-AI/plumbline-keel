#!/usr/bin/env bash
set -Eeuo pipefail
: "${PGDATA:=/var/lib/postgresql/data}"
: "${PGUSER:=postgres}"
: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGCONF:=/etc/postgresql/16/main/postgresql.conf}"
: "${PGPASSWORD:?PGPASSWORD required}"
: "${PGBACKREST_REPO1_S3_BUCKET:?PGBACKREST_REPO1_S3_BUCKET required}"
: "${PGBACKREST_REPO1_S3_ENDPOINT:?PGBACKREST_REPO1_S3_ENDPOINT required}"
: "${PGBACKREST_REPO1_S3_KEY:?PGBACKREST_REPO1_S3_KEY required}"
: "${PGBACKREST_REPO1_S3_KEY_SECRET:?PGBACKREST_REPO1_S3_KEY_SECRET required}"
: "${PGBACKREST_REPO1_S3_REGION:=us-east-1}"
for bin in pgbackrest pg_ctl psql runuser timeout; do command -v "$bin" >/dev/null 2>&1 || { echo "missing:$bin" >&2; exit 127; }; done
install -d -o postgres -g postgres -m 0750 /etc/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest /var/lib/pgbackrest
cat >/etc/pgbackrest/pgbackrest.conf <<EOF
[global]
repo1-type=s3
repo1-path=/keel
repo1-s3-bucket=$PGBACKREST_REPO1_S3_BUCKET
repo1-s3-endpoint=$PGBACKREST_REPO1_S3_ENDPOINT
repo1-s3-region=$PGBACKREST_REPO1_S3_REGION
repo1-s3-key=$PGBACKREST_REPO1_S3_KEY
repo1-s3-key-secret=$PGBACKREST_REPO1_S3_KEY_SECRET
repo1-s3-uri-style=path
repo1-s3-verify-tls=n
repo1-retention-full=2
start-fast=y
log-level-console=info
[keel]
pg1-path=$PGDATA
pg1-port=$PGPORT
pg1-user=$PGUSER
EOF
chmod 600 /etc/pgbackrest/pgbackrest.conf
chown postgres:postgres /etc/pgbackrest/pgbackrest.conf
echo "phase=stanza-create"
timeout 60 runuser -u postgres -- pgbackrest --stanza=keel stanza-create
psql -X -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET archive_mode='on'"
psql -X -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET archive_command='pgbackrest --stanza=keel archive-push %p'"
psql -X -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET archive_timeout='30s'"
echo "phase=stop-source"
timeout 60 runuser -u postgres -- pg_ctl -D "$PGDATA" -m fast -w stop
echo "phase=start-source-with-archiving"
timeout 60 runuser -u postgres -- pg_ctl -D "$PGDATA" -w start -o "-p $PGPORT -c config_file=$PGCONF"
echo "phase=pgbackrest-check"
timeout 60 runuser -u postgres -- pgbackrest --stanza=keel check
psql -X -v ON_ERROR_STOP=1 -c "CREATE TABLE dr_pitr_probe (id integer PRIMARY KEY, marker text NOT NULL)"
echo "phase=full-backup"
timeout 180 runuser -u postgres -- pgbackrest --stanza=keel --type=full backup
psql -X -v ON_ERROR_STOP=1 -c "INSERT INTO dr_pitr_probe VALUES (1, 'before-target')"
psql -X -v ON_ERROR_STOP=1 -c "SELECT pg_create_restore_point('keel_pitr_target')"
psql -X -v ON_ERROR_STOP=1 -c "INSERT INTO dr_pitr_probe VALUES (2, 'after-target')"
prior_wal="$(psql -X -A -t -c "SELECT COALESCE(last_archived_wal, '') FROM pg_stat_archiver")"
psql -X -v ON_ERROR_STOP=1 -c "SELECT pg_switch_wal()"
# Wait for a new WAL segment (not merely any historical archive) to be archived.
for _ in $(seq 1 90); do
  archived="$(psql -X -A -t -c "SELECT COALESCE(last_archived_wal,'') FROM pg_stat_archiver")"
  [[ -n "$archived" && "$archived" != "$prior_wal" ]] && break
  sleep 2
done
[[ -n "${archived:-}" && "$archived" != "$prior_wal" ]] || { echo "WAL archive did not advance" >&2; exit 1; }
restore_dir=/var/lib/postgresql/pitr-restore
rm -rf "$restore_dir"
install -d -o postgres -g postgres -m 0700 "$restore_dir"
echo "phase=pitr-restore"
timeout 180 runuser -u postgres -- pgbackrest --stanza=keel --pg1-path="$restore_dir" --type=name --target=keel_pitr_target --target-action=promote restore
chown -R postgres:postgres "$restore_dir"
echo "phase=start-restored-cluster"
timeout 60 runuser -u postgres -- pg_ctl -D "$restore_dir" -w start -o "-p 5433 -c config_file=$PGCONF -c data_directory=$restore_dir -c listen_addresses=127.0.0.1"
restored_before="$(psql -h 127.0.0.1 -p 5433 -X -A -t -c "SELECT marker FROM dr_pitr_probe WHERE id=1")"
restored_after="$(psql -h 127.0.0.1 -p 5433 -X -A -t -c "SELECT count(*) FROM dr_pitr_probe WHERE id=2")"
[[ "$restored_before" == before-target && "$restored_after" == 0 ]] || { echo "PITR assertion failed: before=$restored_before after_count=$restored_after" >&2; exit 1; }
echo "phase=stop-restored-cluster"
timeout 60 runuser -u postgres -- pg_ctl -D "$restore_dir" -m fast -w stop
echo "S3-backed pgBackRest PITR test passed: restore point retained pre-target data and excluded post-target data."
