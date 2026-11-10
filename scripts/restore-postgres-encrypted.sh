#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${KEEL_BACKUP_FILE:?KEEL_BACKUP_FILE must point to a .age backup}"
: "${KEEL_BACKUP_AGE_IDENTITY_FILE:?KEEL_BACKUP_AGE_IDENTITY_FILE must point to the age identity file}"
: "${KEEL_RESTORE_DATABASE_URL:?KEEL_RESTORE_DATABASE_URL must identify a pre-created empty restore database}"
: "${KEEL_RESTORE_CONFIRM:?Set KEEL_RESTORE_CONFIRM=RESTORE_TO_EMPTY_DATABASE after verifying the target}"
[[ "$KEEL_RESTORE_CONFIRM" == "RESTORE_TO_EMPTY_DATABASE" ]] || { echo "restore_confirmation_invalid" >&2; exit 2; }
[[ -f "$KEEL_BACKUP_FILE" && -f "$KEEL_BACKUP_AGE_IDENTITY_FILE" ]] || { echo "backup_or_identity_file_not_found" >&2; exit 2; }
for bin in age sha256sum pg_restore psql; do command -v "$bin" >/dev/null 2>&1 || { echo "missing_required_command:$bin" >&2; exit 127; }; done
checksum_file="${KEEL_BACKUP_FILE}.sha256"
[[ -f "$checksum_file" ]] || { echo "backup_checksum_file_required" >&2; exit 2; }
(cd "$(dirname "$KEEL_BACKUP_FILE")" && sha256sum --check "$(basename "$checksum_file")")
existing="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND c.relkind IN ('r','p','v','m','S','f')")"
[[ "$existing" =~ ^0$ ]] || { echo "restore_target_not_empty:$existing" >&2; exit 3; }
work="$(mktemp -d "${TMPDIR:-/tmp}/keel-restore.XXXXXXXX")"; trap 'rm -rf "$work"' EXIT
plain="$work/keel-restore.dump"
age --decrypt --identity "$KEEL_BACKUP_AGE_IDENTITY_FILE" --output "$plain" "$KEEL_BACKUP_FILE"
test -s "$plain"; pg_restore --list "$plain" >/dev/null
pg_restore --exit-on-error --no-owner --no-acl --dbname="$KEEL_RESTORE_DATABASE_URL" "$plain"
echo "restore_completed=true"
echo "required_follow_up=node scripts/verify-recovery-state.js"
echo "required_follow_up=compare_independent_checkpoint_and_reconciliation_evidence"
