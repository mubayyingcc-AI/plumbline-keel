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
unapproved_definers="$(psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND p.prosecdef AND r.rolname NOT IN ('keel_auth_owner','keel_backup_audit_owner')")"
[[ "$unapproved_definers" == 0 ]] || { echo "backup_blocked_unrecognized_security_definer_owner" >&2; exit 78; }
unsupported="$(psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','f') AND n.nspname NOT IN ('public','pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'")"
[[ "$unsupported" == 0 ]] || { echo "backup_blocked_non_public_data_relations" >&2; exit 78; }
unsupported="$(psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND ((c.relrowsecurity AND (n.nspname<>'public' OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND a.attnum>0 AND NOT a.attisdropped))) OR (n.nspname='public' AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped) AND (NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND a.attnum>0 AND NOT a.attisdropped) OR NOT c.relrowsecurity)))"
[[ "$unsupported" == 0 ]] || { echo "backup_blocked_unsupported_or_unprotected_tenant_table" >&2; exit 78; }
untrusted_policies="$(psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND a.attnum>0 AND NOT a.attisdropped) AND ((SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)<>1 OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polcmd='*' AND p.polqual::text LIKE '%keel.tenant_id%' AND p.polqual::text LIKE '%tenant_id%'))")"
[[ "$untrusted_policies" == 0 ]] || { echo "backup_blocked_unrecognized_tenant_rls_policy" >&2; exit 78; }
unsupported="$(psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('f','m')")"
[[ "$unsupported" == 0 ]] || { echo "backup_blocked_foreign_or_materialized_relations" >&2; exit 78; }
audit="$(psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT table_name||'|'||unassigned_rows||'|'||orphaned_rows FROM public.keel_backup_tenant_integrity_audit() WHERE unassigned_rows>0 OR orphaned_rows>0 ORDER BY table_name")"
[[ -z "$audit" ]] || { echo "backup_blocked_unassigned_or_orphaned_tenant_rows" >&2; printf '%s\\n' "$audit" >&2; exit 78; }
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
psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -c "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT 'KEEL_SNAPSHOT='||pg_export_snapshot(); SELECT 'KEEL_TENANT='||tenant_id::text FROM public.keel_backup_tenant_ids() ORDER BY tenant_id; SELECT 'KEEL_TENANTS_DONE'; SELECT 'KEEL_TENANT_TABLE='||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname; SELECT 'KEEL_GLOBAL_TABLE='||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND a.attnum>0 AND NOT a.attisdropped) ORDER BY c.relname; SELECT 'KEEL_CATALOG_DONE'; SELECT pg_sleep(3600)" >"$work/snapshot.log" 2>"$work/snapshot.err" &
snapshot_pid=$!
for attempt in $(seq 1 100); do
  if grep -q '^KEEL_CATALOG_DONE$' "$work/snapshot.log" 2>/dev/null; then break; fi
  kill -0 "$snapshot_pid" 2>/dev/null || { cat "$work/snapshot.err" >&2; exit 1; }
  sleep 0.1
done
grep -q '^KEEL_CATALOG_DONE$' "$work/snapshot.log" || { echo "snapshot_catalog_export_incomplete" >&2; exit 1; }
snapshot="$(sed -n 's/^KEEL_SNAPSHOT=//p' "$work/snapshot.log" | head -n1)"
[[ "$snapshot" =~ ^[0-9A-Fa-f-]+$ ]] || { echo "postgres_exported_snapshot_unavailable" >&2; exit 1; }
mapfile -t tenants < <(sed -n 's/^KEEL_TENANT=//p' "$work/snapshot.log")
mapfile -t tenant_tables < <(sed -n 's/^KEEL_TENANT_TABLE=//p' "$work/snapshot.log")
mapfile -t global_tables < <(sed -n 's/^KEEL_GLOBAL_TABLE=//p' "$work/snapshot.log")
(("${#tenants[@]}" > 0)) || { echo "backup_refused_no_tenants_enumerated" >&2; exit 78; }
for tenant in "${tenants[@]}"; do [[ "$tenant" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "invalid_tenant_identifier" >&2; exit 78; }; done
for table in "${tenant_tables[@]}" "${global_tables[@]}"; do [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "unsupported_table_identifier" >&2; exit 78; }; done
(("${#tenant_tables[@]}" > 0)) || { echo "backup_refused_no_tenant_tables" >&2; exit 78; }
printf '%s\\n' "${tenants[@]}" > "$package/tenant-ids.txt"
: > "$package/tenant-row-counts.tsv"
for tenant in "${tenants[@]}"; do
  for table in "${tenant_tables[@]}"; do
    counts="$(PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c keel.tenant_id=$tenant" psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -c "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '$snapshot'; SELECT count(*)::text||'|'||count(*) FILTER (WHERE tenant_id IS DISTINCT FROM '$tenant'::uuid)::text FROM public.\"$table\"; COMMIT;")"
    IFS='|' read -r visible cross_tenant <<< "$counts"
    [[ "$visible" =~ ^[0-9]+$ && "$cross_tenant" == 0 ]] || { echo "tenant_snapshot_visibility_check_failed:$tenant:$table" >&2; exit 78; }
    printf '%s\t%s\t%s\n' "$tenant" "$table" "$visible" >> "$package/tenant-row-counts.tsv"
  done
done
: > "$package/global-row-counts.tsv"
for table in "${global_tables[@]}"; do
  visible="$(psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -c "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '$snapshot'; SELECT count(*) FROM public.\"$table\"; COMMIT;")"
  [[ "$visible" =~ ^[0-9]+$ ]] || { echo "global_snapshot_count_failed:$table" >&2; exit 78; }
  printf '%s\t%s\n' "$table" "$visible" >> "$package/global-row-counts.tsv"
done
: > "$package/tenant-row-counts.tsv"
for tenant in "${tenants[@]}"; do
  for table in "${tenant_tables[@]}"; do
    counts="$(PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c keel.tenant_id=$tenant" psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -c "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '$snapshot'; SELECT count(*)::text||'|'||count(*) FILTER (WHERE tenant_id IS DISTINCT FROM '$tenant'::uuid)::text FROM public.\"$table\"; COMMIT;")"
    IFS='|' read -r visible cross_tenant <<< "$counts"
    [[ "$visible" =~ ^[0-9]+$ && "$cross_tenant" == 0 ]] || { echo "tenant_snapshot_visibility_check_failed:$tenant:$table" >&2; exit 78; }
    printf '%s\t%s\t%s\n' "$tenant" "$table" "$visible" >> "$package/tenant-row-counts.tsv"
  done
done
: > "$package/global-row-counts.tsv"
for table in "${global_tables[@]}"; do
  visible="$(psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -c "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '$snapshot'; SELECT count(*) FROM public.\"$table\"; COMMIT;")"
  [[ "$visible" =~ ^[0-9]+$ ]] || { echo "global_snapshot_count_failed:$table" >&2; exit 78; }
  printf '%s\t%s\n' "$table" "$visible" >> "$package/global-row-counts.tsv"
done
cat > "$package/role-bootstrap.sql" <<'SQL'
-- Recreate only the fixed application roles. Passwords are never exported.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='keel_runtime') THEN
    EXECUTE 'CREATE ROLE keel_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='keel_auth_owner') THEN
    EXECUTE 'CREATE ROLE keel_auth_owner NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='keel_backup_audit_owner') THEN
    EXECUTE 'CREATE ROLE keel_backup_audit_owner NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='keel_backup_reader') THEN
    EXECUTE 'CREATE ROLE keel_backup_reader NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='keel_backup') THEN
    EXECUTE 'CREATE ROLE keel_backup LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2';
  END IF;
END
$roles$;
GRANT keel_backup_reader TO keel_backup;
SQL
{
  echo "-- Restore SECURITY DEFINER functions to their dedicated non-login owners."
  psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT format('ALTER FUNCTION %I.%I(%s) OWNER TO %I;', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), r.rolname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND p.prosecdef ORDER BY p.proname"
} > "$package/security-definer-owners.sql"
pg_dump "$DATABASE_URL" --snapshot="$snapshot" --schema=public --schema-only --no-owner --file="$package/schema.sql"
global_args=(); for table in "${tenant_tables[@]}"; do global_args+=( "--exclude-table=public.$table" ); done
pg_dump "$DATABASE_URL" --snapshot="$snapshot" --schema=public --data-only --inserts --no-owner --no-acl "${global_args[@]}" --file="$package/global-data.sql"
for index in "${!tenants[@]}"; do
  tenant="${tenants[$index]}"; printf -v number '%06d' "$((index+1))"
  tenant_args=(); for table in "${global_tables[@]}"; do tenant_args+=( "--exclude-table=public.$table" ); done
  PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c keel.tenant_id=$tenant" pg_dump "$DATABASE_URL" --snapshot="$snapshot" --schema=public --data-only --enable-row-security --inserts --no-owner --no-acl --no-blobs "${tenant_args[@]}" --file="$package/tenants/tenant-$number.sql"
  test -f "$package/tenants/tenant-$number.sql"
done
# pg_dump emits sequence setval statements in data dumps. Replace them with
# one conservative high-water capture taken after all tenant data exports.
sed -i '/^SELECT pg_catalog.setval(/d' "$package/global-data.sql"
for data_file in "$package"/tenants/*.sql; do sed -i '/^SELECT pg_catalog.setval(/d' "$data_file"; done
{
  echo "-- Sequence high-water marks captured after the consistent row snapshot."
  psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT format('SELECT pg_catalog.setval(%L, %s);', format('%I.%I', schemaname, sequencename), last_value) FROM pg_catalog.pg_sequences WHERE schemaname='public' AND last_value IS NOT NULL ORDER BY sequencename"
} > "$package/sequences.sql"
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
 "$work/snapshot.log" 2>/dev/null && break; kill -0 "$snapshot_pid" 2>/dev/null || { cat "$work/snapshot.err" >&2; exit 1; }; sleep .1; done
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
 "$work/snapshot.log" 2>/dev/null && break
  kill -0 "$snapshot_pid" 2>/dev/null || { cat "$work/snapshot.err" >&2; exit 1; }
  sleep .1
done
grep -q '^KEEL_CATALOG_DONE
snapshot="$(sed -n 's/^KEEL_SNAPSHOT=//p' "$work/snapshot.log" | head -n1)"
[[ "$snapshot" =~ ^[0-9A-Fa-f-]+$ ]] || { echo "postgres_exported_snapshot_unavailable" >&2; exit 1; }
mapfile -t tenants < <(sed -n 's/^KEEL_TENANT=//p' "$work/snapshot.log")
mapfile -t tenant_tables < <(sed -n 's/^KEEL_TENANT_TABLE=//p' "$work/snapshot.log")
mapfile -t global_tables < <(sed -n 's/^KEEL_GLOBAL_TABLE=//p' "$work/snapshot.log")
(("${#tenants[@]}" > 0)) || { echo "backup_refused_no_tenants_enumerated" >&2; exit 78; }
for tenant in "${tenants[@]}"; do [[ "$tenant" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "invalid_tenant_identifier" >&2; exit 78; }; done
for table in "${tenant_tables[@]}" "${global_tables[@]}"; do [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "unsupported_table_identifier" >&2; exit 78; }; done
(("${#tenant_tables[@]}" > 0)) || { echo "backup_refused_no_tenant_tables" >&2; exit 78; }
pg_dump "$DATABASE_URL" --snapshot="$snapshot" --schema=public --schema-only --no-owner --no-acl --file="$package/schema.sql"
global_args=(); for table in "${tenant_tables[@]}"; do global_args+=( "--exclude-table=public.$table" ); done
pg_dump "$DATABASE_URL" --snapshot="$snapshot" --schema=public --data-only --inserts --no-owner --no-acl "${global_args[@]}" --file="$package/global-data.sql"
for index in "${!tenants[@]}"; do
  tenant="${tenants[$index]}"; printf -v number '%06d' "$((index+1))"
  tenant_args=(); for table in "${global_tables[@]}"; do tenant_args+=( "--exclude-table=public.$table" ); done
  PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c keel.tenant_id=$tenant" pg_dump "$DATABASE_URL" --snapshot="$snapshot" --schema=public --data-only --enable-row-security --inserts --no-owner --no-acl --no-blobs "${tenant_args[@]}" --file="$package/tenants/tenant-$number.sql"
  test -f "$package/tenants/tenant-$number.sql"
done
# pg_dump emits sequence setval statements in data dumps. Replace them with
# one conservative high-water capture taken after all tenant data exports.
sed -i '/^SELECT pg_catalog.setval(/d' "$package/global-data.sql"
for data_file in "$package"/tenants/*.sql; do sed -i '/^SELECT pg_catalog.setval(/d' "$data_file"; done
{
  echo "-- Sequence high-water marks captured after the consistent row snapshot."
  psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT format('SELECT pg_catalog.setval(%L, %s);', format('%I.%I', schemaname, sequencename), last_value) FROM pg_catalog.pg_sequences WHERE schemaname='public' AND last_value IS NOT NULL ORDER BY sequencename"
} > "$package/sequences.sql"
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
 "$work/snapshot.log" 2>/dev/null && break; kill -0 "$snapshot_pid" 2>/dev/null || { cat "$work/snapshot.err" >&2; exit 1; }; sleep .1; done
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
 "$work/snapshot.log" || { echo "snapshot_catalog_export_incomplete" >&2; exit 1; }
snapshot="$(sed -n 's/^KEEL_SNAPSHOT=//p' "$work/snapshot.log" | head -n1)"
[[ "$snapshot" =~ ^[0-9A-Fa-f-]+$ ]] || { echo "postgres_exported_snapshot_unavailable" >&2; exit 1; }
mapfile -t tenants < <(sed -n 's/^KEEL_TENANT=//p' "$work/snapshot.log")
mapfile -t tenant_tables < <(sed -n 's/^KEEL_TENANT_TABLE=//p' "$work/snapshot.log")
mapfile -t global_tables < <(sed -n 's/^KEEL_GLOBAL_TABLE=//p' "$work/snapshot.log")
(("${#tenants[@]}" > 0)) || { echo "backup_refused_no_tenants_enumerated" >&2; exit 78; }
for tenant in "${tenants[@]}"; do [[ "$tenant" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "invalid_tenant_identifier" >&2; exit 78; }; done
for table in "${tenant_tables[@]}" "${global_tables[@]}"; do [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "unsupported_table_identifier" >&2; exit 78; }; done
(("${#tenant_tables[@]}" > 0)) || { echo "backup_refused_no_tenant_tables" >&2; exit 78; }
pg_dump "$DATABASE_URL" --snapshot="$snapshot" --schema=public --schema-only --no-owner --no-acl --file="$package/schema.sql"
global_args=(); for table in "${tenant_tables[@]}"; do global_args+=( "--exclude-table=public.$table" ); done
pg_dump "$DATABASE_URL" --snapshot="$snapshot" --schema=public --data-only --inserts --no-owner --no-acl "${global_args[@]}" --file="$package/global-data.sql"
for index in "${!tenants[@]}"; do
  tenant="${tenants[$index]}"; printf -v number '%06d' "$((index+1))"
  tenant_args=(); for table in "${global_tables[@]}"; do tenant_args+=( "--exclude-table=public.$table" ); done
  PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c keel.tenant_id=$tenant" pg_dump "$DATABASE_URL" --snapshot="$snapshot" --schema=public --data-only --enable-row-security --inserts --no-owner --no-acl --no-blobs "${tenant_args[@]}" --file="$package/tenants/tenant-$number.sql"
  test -f "$package/tenants/tenant-$number.sql"
done
# pg_dump emits sequence setval statements in data dumps. Replace them with
# one conservative high-water capture taken after all tenant data exports.
sed -i '/^SELECT pg_catalog.setval(/d' "$package/global-data.sql"
for data_file in "$package"/tenants/*.sql; do sed -i '/^SELECT pg_catalog.setval(/d' "$data_file"; done
{
  echo "-- Sequence high-water marks captured after the consistent row snapshot."
  psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT format('SELECT pg_catalog.setval(%L, %s);', format('%I.%I', schemaname, sequencename), last_value) FROM pg_catalog.pg_sequences WHERE schemaname='public' AND last_value IS NOT NULL ORDER BY sequencename"
} > "$package/sequences.sql"
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
 "$work/snapshot.log" 2>/dev/null && break; kill -0 "$snapshot_pid" 2>/dev/null || { cat "$work/snapshot.err" >&2; exit 1; }; sleep .1; done
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
