#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${KEEL_BACKUP_FILE:?KEEL_BACKUP_FILE required}"
: "${KEEL_BACKUP_AGE_IDENTITY_FILE:?KEEL_BACKUP_AGE_IDENTITY_FILE required}"
: "${KEEL_RESTORE_DATABASE_URL:?KEEL_RESTORE_DATABASE_URL required}"
: "${KEEL_RESTORE_CONFIRM:?Set RESTORE_TO_EMPTY_DATABASE after checking target}"
: "${KEEL_RESTORE_EXPECTED_DATABASE_ID:?Expected source database identity required}"
[[ "$KEEL_RESTORE_CONFIRM" == RESTORE_TO_EMPTY_DATABASE ]] || { echo "restore_confirmation_invalid" >&2; exit 2; }
[[ -f "$KEEL_BACKUP_FILE" && -f "$KEEL_BACKUP_AGE_IDENTITY_FILE" && -f "${KEEL_BACKUP_FILE}.sha256" && -f "${KEEL_BACKUP_FILE}.manifest.json" ]] || { echo "required_restore_file_missing" >&2; exit 2; }
mode="$(stat -c %a "$KEEL_BACKUP_AGE_IDENTITY_FILE")"
[[ "$mode" == 600 ]] || { echo "decryption_identity_must_be_mode_0600" >&2; exit 2; }
for bin in age age-keygen sha256sum pg_restore psql node; do command -v "$bin" >/dev/null 2>&1 || { echo "missing_required_command:$bin" >&2; exit 127; }; done
(cd "$(dirname "$KEEL_BACKUP_FILE")" && sha256sum --check "$(basename "$KEEL_BACKUP_FILE").sha256")

recipient="$(age-keygen -y "$KEEL_BACKUP_AGE_IDENTITY_FILE")"
node - "$KEEL_BACKUP_FILE" "${KEEL_BACKUP_FILE}.manifest.json" "$KEEL_RESTORE_EXPECTED_DATABASE_ID" "$recipient" <<'NODE'
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const [artifact,manifestPath,expectedDatabaseId,recipient]=process.argv.slice(2);
const m=JSON.parse(fs.readFileSync(manifestPath,'utf8')), bytes=fs.readFileSync(artifact);
const digest=crypto.createHash('sha256').update(bytes).digest('hex');
const recipientFingerprint=crypto.createHash('sha256').update(recipient).digest('hex');
if(m.format!=='keel-encrypted-postgres-backup/v1'||m.databaseId!==expectedDatabaseId||m.artifact!==path.basename(artifact)||m.bytes!==bytes.length||m.sha256!==digest||m.recipientFingerprint!==recipientFingerprint) {
  process.stderr.write('backup_manifest_identity_or_integrity_mismatch\n'); process.exit(1);
}
NODE
count="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND c.relkind IN ('r','p','v','m','S','f')")"
[[ "$count" =~ ^0$ ]] || { echo "restore_target_not_empty:$count" >&2; exit 3; }
work="$(mktemp -d "${TMPDIR:-/tmp}/keel-restore.XXXXXXXX")"; trap 'rm -rf "$work"' EXIT
plain="$work/restore.dump"; age --decrypt --identity "$KEEL_BACKUP_AGE_IDENTITY_FILE" --output "$plain" "$KEEL_BACKUP_FILE"
test -s "$plain"; pg_restore --list "$plain" >/dev/null
pg_restore --exit-on-error --no-owner --no-acl --dbname="$KEEL_RESTORE_DATABASE_URL" "$plain"
echo "restore_completed=true"
