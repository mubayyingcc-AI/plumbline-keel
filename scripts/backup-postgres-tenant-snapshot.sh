#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${DATABASE_URL:?DATABASE_URL must use keel_backup}"
: "${KEEL_BACKUP_DIR:?KEEL_BACKUP_DIR required}"
: "${KEEL_BACKUP_AGE_RECIPIENT:?KEEL_BACKUP_AGE_RECIPIENT required}"
: "${KEEL_BACKUP_DATABASE_ID:?KEEL_BACKUP_DATABASE_ID required}"
for bin in psql pg_dump age sha256sum node tar; do command -v "$bin" >/dev/null 2>&1 || { echo "missing_required_command:$bin" >&2; exit 127; }; done
identity="$(psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT current_user||'|'||rolsuper||'|'||rolbypassrls||'|'||rolcreatedb||'|'||rolcreaterole||'|'||rolreplication FROM pg_roles WHERE rolname=current_user")"
[[ "$identity" == "keel_backup|f|f|f|f|f" ]] || { echo "backup_requires_dedicated_non_bypass_keel_backup_login" >&2; exit 78; }
unsupported="$(psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND c.relrowsecurity AND (n.nspname<>'public' OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND a.attnum>0 AND NOT a.attisdropped))")"
[[ "$unsupported" == 0 ]] || { echo "backup_blocked_unsupported_rls_table_layout" >&2; exit 78; }
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "SELECT tenant_id FROM public.keel_backup_tenant_ids() LIMIT 0" >/dev/null
mkdir -p "$KEEL_BACKUP_DIR"; chmod 700 "$KEEL_BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="$(mktemp -d "${TMPDIR:-/tmp}/keel-backup.XXXXXXXX")"
snapshot_pid=""
cleanup(){ if [[ -n "$snapshot_pid" ]]; then kill "$snapshot_pid" 2>/dev/null || true; wait "$snapshot_pid" 2>/dev/null || true; fi; rm -rf "$work"; }
trap cleanup EXIT
mkdir -m 700 "$work/package" "$work/package/tenants"
package="$work/package"
# One held REPEATABLE READ snapshot covers tenant enumeration, schema and every data export.
psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -c "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT 'KEEL_SNAPSHOT='||pg_export_snapshot(); SELECT 'KEEL_TENANT='||tenant_id::text FROM public.keel_backup_tenant_ids() ORDER BY tenant_id; SELECT pg_sleep(3600)" >"$work/snapshot.log" 2>"$work/snapshot.err" &
snapshot_pid=$!
for attempt in $(seq 1 100); do grep -q '^KEEL_SNAPSHOT=' "$work/snapshot.log" 2>/dev/null && break; kill -0 "$snapshot_pid" 2>/dev/null || { cat "$work/snapshot.err" >&2; exit 1; }; sleep .1; done
snapshot="$(sed -n 's/^KEEL_SNAPSHOT=//p' "$work/snapshot.log" | head -n1)"
[[ "$snapshot" =~ ^[0-9A-Fa-f-]+$ ]] || { echo "postgres_exported_snapshot_unavailable" >&2; exit 1; }
mapfile -t tenants < <(sed -n 's/^KEEL_TENANT=//p' "$work/snapshot.log")
(("${#tenants[@]}" > 0)) || { echo "backup_refused_no_tenants_enumerated" >&2; exit 78; }
for tenant in "${tenants[@]}"; do [[ "$tenant" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "invalid_tenant_identifier" >&2; exit 78; }; done
mapfile -t tenant_tables < <(psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname")
mapfile -t global_tables < <(psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND a.attnum>0 AND NOT a.attisdropped) ORDER BY c.relname")
for table in "${tenant_tables[@]}" "${global_tables[@]}"; do [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "unsupported_table_identifier" >&2; exit 78; }; done
(("${#tenant_tables[@]}" > 0)) || { echo "backup_refused_no_tenant_tables" >&2; exit 78; }
pg_dump "$DATABASE_URL" --snapshot="$snapshot" --schema-only --no-owner --no-acl --file="$package/schema.sql"
global_args=(); for table in "${tenant_tables[@]}"; do global_args+=( "--exclude-table=public.$table" ); done
pg_dump "$DATABASE_URL" --snapshot="$snapshot" --data-only --inserts --no-owner --no-acl "${global_args[@]}" --file="$package/global-data.sql"
for index in "${!tenants[@]}"; do
  tenant="${tenants[$index]}"; printf -v number '%06d' "$((index+1))"
  tenant_args=(); for table in "${global_tables[@]}"; do tenant_args+=( "--exclude-table=public.$table" ); done
  PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c keel.tenant_id=$tenant" pg_dump "$DATABASE_URL" --snapshot="$snapshot" --data-only --enable-row-security --inserts --no-owner --no-acl --no-blobs "${tenant_args[@]}" --file="$package/tenants/tenant-$number.sql"
  test -f "$package/tenants/tenant-$number.sql"
done
version="$(psql "$DATABASE_URL" -X -A -t -c 'SHOW server_version' | tr -d '\r')"
node - "$package" "$stamp" "$version" "$KEEL_BACKUP_DATABASE_ID" "$snapshot" "${#tenants[@]}" "${#tenant_tables[@]}" "${#global_tables[@]}" <<'NODE'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [dir,createdAt,postgresVersion,databaseId,snapshot,tenantCount,tenantTableCount,globalTableCount]=process.argv.slice(2);
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),files=[];
function walk(base,rel=''){for(const e of fs.readdirSync(path.join(base,rel),{withFileTypes:true})){const r=path.join(rel,e.name);if(e.isDirectory())walk(base,r);else files.push({path:r,bytes:fs.statSync(path.join(base,r)).size,sha256:digest(path.join(base,r))});}}
walk(dir);fs.writeFileSync(path.join(dir,'PACKAGE-MANIFEST.json'),JSON.stringify({format:'keel-tenant-snapshot-package/v1',createdAt,postgresVersion,databaseId,snapshotId:snapshot,tenantCount:Number(tenantCount),tenantTableCount:Number(tenantTableCount),globalTableCount:Number(globalTableCount),files},null,2)+'\n',{mode:0o600,flag:'wx'});
NODE
tar -C "$work" -czf "$work/package.tar.gz" package
encrypted="$KEEL_BACKUP_DIR/keel-$stamp.tenant-snapshot.tar.gz.age"
age --encrypt --recipient "$KEEL_BACKUP_AGE_RECIPIENT" --output "$work/backup.age" "$work/package.tar.gz"
mv "$work/backup.age" "$encrypted"; chmod 600 "$encrypted"
sha256sum "$encrypted" > "$encrypted.sha256"; chmod 600 "$encrypted.sha256"
node - "$encrypted" "$work/manifest.json" "$stamp" "$version" "$KEEL_BACKUP_DATABASE_ID" "$KEEL_BACKUP_AGE_RECIPIENT" "${#tenants[@]}" <<'NODE'
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const [file,out,createdAt,postgresVersion,databaseId,recipient,tenantCount]=process.argv.slice(2),bytes=fs.readFileSync(file);
fs.writeFileSync(out,JSON.stringify({format:'keel-encrypted-postgres-backup/v2',createdAt,databaseId,postgresVersion,encryption:'age',recipientFingerprint:crypto.createHash('sha256').update(recipient).digest('hex'),artifact:path.basename(file),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),tenantCount:Number(tenantCount)},null,2)+'\n',{mode:0o600,flag:'wx'});
NODE
mv "$work/manifest.json" "$encrypted.manifest.json"; chmod 600 "$encrypted.manifest.json"
echo "encrypted_tenant_snapshot_backup_created=$encrypted"
if [[ -n "${KEEL_BACKUP_S3_BUCKET:-}" ]]; then
  : "${KEEL_BACKUP_S3_ENDPOINT:?}"; : "${KEEL_BACKUP_S3_REGION:?}"; : "${AWS_ACCESS_KEY_ID:?}"; : "${AWS_SECRET_ACCESS_KEY:?}"
  [[ "$KEEL_BACKUP_S3_ENDPOINT" == https://* || "${KEEL_BACKUP_ALLOW_INSECURE_TEST_ENDPOINT:-false}" == true ]] || { echo "remote_backup_endpoint_must_use_https" >&2; exit 2; }
  command -v aws >/dev/null 2>&1 || { echo "aws_cli_required" >&2; exit 127; }
  prefix="${KEEL_BACKUP_S3_PREFIX:-keel}/$KEEL_BACKUP_DATABASE_ID/$stamp"
  for file in "$encrypted" "$encrypted.sha256" "$encrypted.manifest.json"; do aws --endpoint-url "$KEEL_BACKUP_S3_ENDPOINT" --region "$KEEL_BACKUP_S3_REGION" s3 cp --only-show-errors "$file" "s3://$KEEL_BACKUP_S3_BUCKET/$prefix/$(basename "$file")"; done
  echo "remote_backup_prefix=s3://$KEEL_BACKUP_S3_BUCKET/$prefix/"
fi
