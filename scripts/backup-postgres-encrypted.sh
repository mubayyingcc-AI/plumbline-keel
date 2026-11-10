#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${DATABASE_URL:?DATABASE_URL required}"
: "${KEEL_BACKUP_DIR:?KEEL_BACKUP_DIR required}"
: "${KEEL_BACKUP_AGE_RECIPIENT:?KEEL_BACKUP_AGE_RECIPIENT required}"
: "${KEEL_BACKUP_DATABASE_ID:?KEEL_BACKUP_DATABASE_ID required}"
for bin in pg_dump psql age sha256sum node; do command -v "$bin" >/dev/null 2>&1 || { echo "missing_required_command:$bin" >&2; exit 127; }; done
mkdir -p "$KEEL_BACKUP_DIR"; chmod 700 "$KEEL_BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="$(mktemp -d "${TMPDIR:-/tmp}/keel-backup.XXXXXXXX")"; trap 'rm -rf "$work"' EXIT
plain="$work/keel-$stamp.dump"; encrypted="$KEEL_BACKUP_DIR/keel-$stamp.dump.age"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl --file="$plain"; test -s "$plain"
age --encrypt --recipient "$KEEL_BACKUP_AGE_RECIPIENT" --output "$work/backup.age" "$plain"; test -s "$work/backup.age"
mv "$work/backup.age" "$encrypted"; chmod 600 "$encrypted"
(cd "$KEEL_BACKUP_DIR" && sha256sum "$(basename "$encrypted")") > "$encrypted.sha256"; chmod 600 "$encrypted.sha256"
version="$(psql "$DATABASE_URL" -X -A -t -c 'SHOW server_version' | tr -d '\r')"
node - "$encrypted" "$work/manifest.json" "$stamp" "$version" "$KEEL_BACKUP_DATABASE_ID" "$KEEL_BACKUP_AGE_RECIPIENT" <<'NODE'
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const [file,out,createdAt,postgresVersion,databaseId,recipient]=process.argv.slice(2),bytes=fs.readFileSync(file);
const m={format:'keel-encrypted-postgres-backup/v1',createdAt,databaseId,postgresVersion,encryption:'age',recipientFingerprint:crypto.createHash('sha256').update(recipient).digest('hex'),artifact:path.basename(file),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
fs.writeFileSync(out,JSON.stringify(m,null,2)+'\n',{mode:0o600,flag:'wx'});
NODE
mv "$work/manifest.json" "$encrypted.manifest.json"; chmod 600 "$encrypted.manifest.json"
echo "encrypted_backup_created=$encrypted"

# Optional remote copy. Encryption is completed before upload.
# Configure independent IAM and deletion-resistant retention on the destination.
if [[ -n "${KEEL_BACKUP_S3_BUCKET:-}" ]]; then
  : "${KEEL_BACKUP_S3_ENDPOINT:?KEEL_BACKUP_S3_ENDPOINT required}"
  : "${KEEL_BACKUP_S3_REGION:?KEEL_BACKUP_S3_REGION required}"
  : "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID required}"
  : "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY required}"
  [[ "$KEEL_BACKUP_S3_ENDPOINT" == https://* ]] || { echo "remote_backup_endpoint_must_use_https" >&2; exit 2; }
  command -v aws >/dev/null 2>&1 || { echo "aws_cli_required_for_remote_backup" >&2; exit 127; }
  prefix="${KEEL_BACKUP_S3_PREFIX:-keel}/$KEEL_BACKUP_DATABASE_ID/$stamp"
  aws --endpoint-url "$KEEL_BACKUP_S3_ENDPOINT" --region "$KEEL_BACKUP_S3_REGION" s3 cp --only-show-errors "$encrypted" "s3://$KEEL_BACKUP_S3_BUCKET/$prefix/$(basename "$encrypted")"
  aws --endpoint-url "$KEEL_BACKUP_S3_ENDPOINT" --region "$KEEL_BACKUP_S3_REGION" s3 cp --only-show-errors "$encrypted.sha256" "s3://$KEEL_BACKUP_S3_BUCKET/$prefix/$(basename "$encrypted").sha256"
  aws --endpoint-url "$KEEL_BACKUP_S3_ENDPOINT" --region "$KEEL_BACKUP_S3_REGION" s3 cp --only-show-errors "$encrypted.manifest.json" "s3://$KEEL_BACKUP_S3_BUCKET/$prefix/$(basename "$encrypted").manifest.json"
  echo "remote_backup_prefix=s3://$KEEL_BACKUP_S3_BUCKET/$prefix/"
fi

