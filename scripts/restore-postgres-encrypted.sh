#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${KEEL_BACKUP_FILE:?KEEL_BACKUP_FILE required}"
: "${KEEL_BACKUP_AGE_IDENTITY_FILE:?KEEL_BACKUP_AGE_IDENTITY_FILE required}"
: "${KEEL_RESTORE_DATABASE_URL:?KEEL_RESTORE_DATABASE_URL required}"
: "${KEEL_RESTORE_CONFIRM:?Set RESTORE_TO_EMPTY_DATABASE after checking target}"
[[ "$KEEL_RESTORE_CONFIRM" == RESTORE_TO_EMPTY_DATABASE ]] || { echo "restore_confirmation_invalid" >&2; exit 2; }
[[ -f "$KEEL_BACKUP_FILE" && -f "$KEEL_BACKUP_AGE_IDENTITY_FILE" && -f "${KEEL_BACKUP_FILE}.sha256" ]] || { echo "required_restore_file_missing" >&2; exit 2; }
for bin in age sha256sum pg_restore psql; do command -v "$bin" >/dev/null 2>&1 || { echo "missing_required_command:$bin" >&2; exit 127; }; done
(cd "$(dirname "$KEEL_BACKUP_FILE")" && sha256sum --check "$(basename "$KEEL_BACKUP_FILE").sha256")
count="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND c.relkind IN ('r','p','v','m','S','f')")"
[[ "$count" =~ ^0$ ]] || { echo "restore_target_not_empty:$count" >&2; exit 3; }
work="$(mktemp -d "${TMPDIR:-/tmp}/keel-restore.XXXXXXXX")"; trap 'rm -rf "$work"' EXIT
plain="$work/restore.dump"
age --decrypt --identity "$KEEL_BACKUP_AGE_IDENTITY_FILE" --output "$plain" "$KEEL_BACKUP_FILE"
test -s "$plain"; pg_restore --list "$plain" >/dev/null
pg_restore --exit-on-error --no-owner --no-acl --dbname="$KEEL_RESTORE_DATABASE_URL" "$plain"
echo "restore_completed=true"
