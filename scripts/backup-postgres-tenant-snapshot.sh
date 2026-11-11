#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL must use the dedicated keel_backup login}"
: "${KEEL_BACKUP_DIR:?KEEL_BACKUP_DIR required}"
: "${KEEL_BACKUP_AGE_RECIPIENT:?KEEL_BACKUP_AGE_RECIPIENT required}"
: "${KEEL_BACKUP_DATABASE_ID:?KEEL_BACKUP_DATABASE_ID required}"

for bin in psql pg_dump age sha256sum node tar awk grep sed; do
  command -v "$bin" >/dev/null 2>&1 || { echo "missing_required_command:$bin" >&2; exit 127; }
done

psqlq() { psql "$DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 "$@"; }

identity="$(psqlq -c "SELECT current_user||'|'||CASE WHEN rolsuper THEN '1' ELSE '0' END||'|'||CASE WHEN rolbypassrls THEN '1' ELSE '0' END||'|'||CASE WHEN rolcreatedb THEN '1' ELSE '0' END||'|'||CASE WHEN rolcreaterole THEN '1' ELSE '0' END||'|'||CASE WHEN rolreplication THEN '1' ELSE '0' END FROM pg_roles WHERE rolname=current_user")"
[[ "$identity" == "keel_backup|0|0|0|0|0" ]] || { echo "backup_requires_dedicated_non_bypass_keel_backup_login" >&2; exit 78; }

unsupported="$(psqlq -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','f','m') AND n.nspname NOT IN ('public','pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'" )"
[[ "$unsupported" == 0 ]] || { echo "backup_blocked_non_public_data_relations" >&2; exit 78; }

# A snapshot backup is supported only for ordinary public tables with a
# single UUID tenant key, FORCE RLS, a tenant-setting policy and an enforceable
# non-null tenant key. Unknown data-bearing relation types fail closed.
unsupported="$(psqlq -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('p','f','m')")"
[[ "$unsupported" == 0 ]] || { echo "backup_blocked_partitioned_foreign_or_materialized_relations" >&2; exit 78; }

unsupported="$(
psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 <<'SQL'
SELECT count(*)
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
AND (
  (c.relrowsecurity AND NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid='uuid'::regtype
  ))
  OR
  (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped)
   AND NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid='uuid'::regtype
   ))
  OR
  (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped)
   AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR NOT EXISTS (
     SELECT 1 FROM pg_policies p
     WHERE p.schemaname='public' AND p.tablename=c.relname
       AND (coalesce(p.qual,'')||coalesce(p.with_check,'')) LIKE '%keel.tenant_id%'
   )))
  OR
  (c.relrowsecurity AND NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid='uuid'::regtype
  ))
  OR
  (EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid='uuid'::regtype AND NOT a.attnotnull
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped
    WHERE con.conrelid=c.oid AND con.contype='c' AND con.convalidated
      AND pg_get_constraintdef(con.oid) ~* 'tenant_id IS NOT NULL'
  ))
  OR
  (EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid='uuid'::regtype
  ) AND c.relname<>'keel_tenants' AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint fk
    JOIN pg_attribute tenant_key ON tenant_key.attrelid='public.keel_tenants'::regclass AND tenant_key.attname='tenant_id' AND tenant_key.attnum>0
    JOIN pg_attribute local_key ON local_key.attrelid=c.oid AND local_key.attname='tenant_id' AND local_key.attnum>0
    WHERE fk.conrelid=c.oid AND fk.confrelid='public.keel_tenants'::regclass AND fk.contype='f'
      AND fk.conkey=ARRAY[local_key.attnum]::smallint[]
      AND fk.confkey=ARRAY[tenant_key.attnum]::smallint[]
  ))
)
SQL
)"
[[ "$unsupported" == 0 ]] || { echo "backup_blocked_unsupported_or_unprotected_tenant_table" >&2; exit 78; }

large_objects="$(psqlq -c "SELECT count(*) FROM pg_largeobject_metadata")"
[[ "$large_objects" == 0 ]] || { echo "backup_blocked_unmapped_large_objects" >&2; exit 78; }

privileged_roles="$(psqlq -c "SELECT count(*) FROM pg_roles WHERE rolname !~ '^pg_' AND rolname<>'postgres' AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR (rolbypassrls AND rolname<>'keel_auth_owner'))")"
[[ "$privileged_roles" == 0 ]] || { echo "backup_blocked_unapproved_privileged_database_role" >&2; exit 78; }
auth_owner="$(psqlq -c "SELECT count(*) FROM pg_roles WHERE rolname='keel_auth_owner' AND NOT rolsuper AND NOT rolcanlogin AND rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication")"
[[ "$auth_owner" == 1 ]] || { echo "backup_blocked_keel_auth_owner_boundary_invalid" >&2; exit 78; }
auth_owner_members="$(psqlq -c "SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname='keel_auth_owner'")"
[[ "$auth_owner_members" == 0 ]] || { echo "backup_blocked_auth_owner_role_membership" >&2; exit 78; }
psqlq -c "SELECT tenant_id FROM public.keel_backup_tenant_ids() LIMIT 0" >/dev/null

mkdir -p "$KEEL_BACKUP_DIR"
chmod 700 "$KEEL_BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="$(mktemp -d "${TMPDIR:-/tmp}/keel-backup.XXXXXXXX")"
snapshot_pid=""
cleanup() {
  if [[ -n "$snapshot_pid" ]]; then
    kill "$snapshot_pid" 2>/dev/null || true
    wait "$snapshot_pid" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

package="$work/package"
mkdir -m 700 "$package" "$package/tenants"

# The keeper holds the exported REPEATABLE READ snapshot open until every
# schema, row-count and data export has imported the same snapshot identifier.
psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 >"$work/snapshot.log" 2>"$work/snapshot.err" <<'SQL' &
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'KEEL_SNAPSHOT=' || pg_export_snapshot();
SELECT 'KEEL_TENANT=' || tenant_id::text FROM public.keel_backup_tenant_ids() ORDER BY tenant_id;
SELECT 'KEEL_TENANT_TABLE=' || c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_attribute a ON a.attrelid=c.oid
WHERE n.nspname='public' AND c.relkind='r'
  AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype
  AND a.attnum>0 AND NOT a.attisdropped
ORDER BY c.relname;
SELECT 'KEEL_GLOBAL_TABLE=' || c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
  AND NOT EXISTS (
    SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid
      AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype
      AND a.attnum>0 AND NOT a.attisdropped
  )
ORDER BY c.relname;
SELECT 'KEEL_CATALOG_DONE';
SELECT pg_sleep(14400);
COMMIT;
SQL
snapshot_pid=$!

ready=false
for attempt in $(seq 1 150); do
  if grep -qx 'KEEL_CATALOG_DONE' "$work/snapshot.log"; then ready=true; break; fi
  if ! kill -0 "$snapshot_pid" 2>/dev/null; then
    cat "$work/snapshot.err" >&2
    echo "backup_snapshot_keeper_exited_before_catalog_ready" >&2
    exit 1
  fi
  sleep 0.2
done
[[ "$ready" == true ]] || { echo "backup_snapshot_catalog_timeout" >&2; exit 1; }

snapshot="$(sed -n 's/^KEEL_SNAPSHOT=//p' "$work/snapshot.log" | head -n1)"
[[ "$snapshot" =~ ^[0-9A-Fa-f-]+$ ]] || { echo "postgres_exported_snapshot_unavailable" >&2; exit 1; }
mapfile -t tenants < <(sed -n 's/^KEEL_TENANT=//p' "$work/snapshot.log")
mapfile -t tenant_tables < <(sed -n 's/^KEEL_TENANT_TABLE=//p' "$work/snapshot.log")
mapfile -t global_tables < <(sed -n 's/^KEEL_GLOBAL_TABLE=//p' "$work/snapshot.log")
(( ${#tenants[@]} > 0 )) || { echo "backup_refused_no_tenants_enumerated" >&2; exit 78; }
(( ${#tenant_tables[@]} > 0 )) || { echo "backup_refused_no_tenant_tables" >&2; exit 78; }
for tenant in "${tenants[@]}"; do [[ "$tenant" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "invalid_tenant_identifier" >&2; exit 78; }; done
for table in "${tenant_tables[@]}" "${global_tables[@]}"; do [[ "$table" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "unsupported_table_identifier" >&2; exit 78; }; done

# Export role names/attributes without password hashes. Restore recreates
# custom roles without passwords; credentials must be provisioned separately.
psql "$DATABASE_URL" -X -A -t -F $'\t' -v ON_ERROR_STOP=1 -c "
SELECT rolname,rolcanlogin,rolinherit,rolconnlimit,rolbypassrls
FROM pg_roles
WHERE rolname !~ '^pg_' AND rolname<>'postgres'
ORDER BY rolname
" >"$package/roles.tsv"
psql "$DATABASE_URL" -X -A -t -F $'\t' -v ON_ERROR_STOP=1 -c "
SELECT granted.rolname,member.rolname,m.admin_option
FROM pg_auth_members m
JOIN pg_roles granted ON granted.oid=m.roleid
JOIN pg_roles member ON member.oid=m.member
WHERE granted.rolname !~ '^pg_' AND member.rolname !~ '^pg_'
  AND granted.rolname<>'postgres' AND member.rolname<>'postgres'
ORDER BY granted.rolname,member.rolname
" >"$package/role-memberships.tsv"

pg_dump "$DATABASE_URL" --snapshot="$snapshot" --schema=public --schema-only --file="$package/schema.sql"

tenant_args=()
for table in "${tenant_tables[@]}"; do tenant_args+=( "--table=public.$table" ); done
global_args=()
for table in "${global_tables[@]}"; do global_args+=( "--table=public.$table" ); done

if (( ${#global_args[@]} > 0 )); then
  pg_dump "$DATABASE_URL" --snapshot="$snapshot" --schema=public --data-only --inserts --rows-per-insert=1 --no-owner --no-acl "${global_args[@]}" --file="$package/global-data.sql"
else
  : >"$package/global-data.sql"
fi

coverage="$package/coverage.tsv"
printf 'scope\ttenant_id\ttable\texpected_rows\texported_rows\n' >"$coverage"
count_rows() {
  local tenant="$1" table="$2" snapshot_id="$3" value
  if [[ "$tenant" == "GLOBAL" ]]; then
    value="$(psqlq -c "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '$snapshot_id'; SELECT count(*) FROM public.\"$table\"; COMMIT;")"
  else
    value="$(PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c keel.tenant_id=$tenant" psqlq -c "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '$snapshot_id'; SELECT count(*) FROM public.\"$table\"; COMMIT;")"
  fi
  [[ "$value" =~ ^[0-9]+$ ]] || { printf "backup_row_count_failed:%s:%s:output=%q\\n" "$tenant" "$table" "$value" >&2; exit 1; }
  printf '%s' "$value"
}
count_inserts() {
  local file="$1" table="$2"
  awk -v expected="$table" '
    $1=="INSERT" && $2=="INTO" {
      name=$3
      sub(/^public\./,"",name)
      sub(/\(.*/,"",name)
      gsub(/"/,"",name)
      if (name==expected) count++
    }
    END { print count+0 }
  ' "$file"
}

global_dump="$package/global-data.sql"
for table in "${global_tables[@]}"; do
  expected="$(count_rows GLOBAL "$table" "$snapshot")"
  actual="$(count_inserts "$global_dump" "$table")"
  [[ "$expected" == "$actual" ]] || { echo "backup_global_row_coverage_mismatch:$table:$expected:$actual" >&2; exit 78; }
  printf 'GLOBAL\t-\t%s\t%s\t%s\n' "$table" "$expected" "$actual" >>"$coverage"
done

for index in "${!tenants[@]}"; do
  tenant="${tenants[$index]}"
  printf -v number '%06d' "$((index+1))"
  dump_file="$package/tenants/tenant-$number.sql"
  pg_dump "$DATABASE_URL" --snapshot="$snapshot" --schema=public --data-only --enable-row-security --inserts --rows-per-insert=1 --no-owner --no-acl "${tenant_args[@]}" --file="$dump_file"
  test -f "$dump_file"
  for table in "${tenant_tables[@]}"; do
    expected="$(count_rows "$tenant" "$table" "$snapshot")"
    actual="$(count_inserts "$dump_file" "$table")"
    [[ "$expected" == "$actual" ]] || { echo "backup_tenant_row_coverage_mismatch:$tenant:$table:$expected:$actual" >&2; grep -n '^INSERT' "$dump_file" | head -n 20 >&2 || true; exit 78; }
    printf 'TENANT\t%s\t%s\t%s\t%s\n' "$tenant" "$table" "$expected" "$actual" >>"$coverage"
  done
done

# Sequence state is non-transactional in PostgreSQL. Capture the high-water
# values after the snapshot exports so restored sequences cannot move backwards.
{
  echo "-- Sequence high-water marks captured after all row exports."
  psqlq -c "SELECT format('SELECT pg_catalog.setval(%L, %s);', format('%I.%I', schemaname, sequencename), last_value) FROM pg_catalog.pg_sequences WHERE schemaname='public' AND last_value IS NOT NULL ORDER BY sequencename"
} >"$package/sequences.sql"

version="$(psqlq -c 'SHOW server_version')"
node - "$package" "$stamp" "$version" "$KEEL_BACKUP_DATABASE_ID" "$snapshot" "${#tenants[@]}" "${#tenant_tables[@]}" "${#global_tables[@]}" <<'NODE'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [dir,createdAt,postgresVersion,databaseId,snapshot,tenantCount,tenantTableCount,globalTableCount]=process.argv.slice(2);
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),files=[];
function walk(base,rel=''){for(const e of fs.readdirSync(path.join(base,rel),{withFileTypes:true})){const r=path.join(rel,e.name);if(e.isDirectory())walk(base,r);else files.push({path:r,bytes:fs.statSync(path.join(base,r)).size,sha256:digest(path.join(base,r))});}}
walk(dir);
fs.writeFileSync(path.join(dir,'PACKAGE-MANIFEST.json'),JSON.stringify({format:'keel-tenant-snapshot-package/v2',createdAt,postgresVersion,databaseId,snapshotId:snapshot,tenantCount:Number(tenantCount),tenantTableCount:Number(tenantTableCount),globalTableCount:Number(globalTableCount),files},null,2)+'\n',{mode:0o600,flag:'wx'});
NODE

tar -C "$work" -czf "$work/package.tar.gz" package
encrypted="$KEEL_BACKUP_DIR/keel-$stamp.tenant-snapshot.tar.gz.age"
[[ ! -e "$encrypted" ]] || { echo "backup_artifact_collision" >&2; exit 1; }
age --encrypt --recipient "$KEEL_BACKUP_AGE_RECIPIENT" --output "$work/backup.age" "$work/package.tar.gz"
mv "$work/backup.age" "$encrypted"
chmod 600 "$encrypted"
sha256sum "$encrypted" >"$encrypted.sha256"
chmod 600 "$encrypted.sha256"
node - "$encrypted" "$work/manifest.json" "$stamp" "$version" "$KEEL_BACKUP_DATABASE_ID" "$KEEL_BACKUP_AGE_RECIPIENT" "${#tenants[@]}" <<'NODE'
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const [file,out,createdAt,postgresVersion,databaseId,recipient,tenantCount]=process.argv.slice(2),bytes=fs.readFileSync(file);
fs.writeFileSync(out,JSON.stringify({format:'keel-encrypted-postgres-backup/v2',createdAt,databaseId,postgresVersion,encryption:'age',recipientFingerprint:crypto.createHash('sha256').update(recipient).digest('hex'),artifact:path.basename(file),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),tenantCount:Number(tenantCount)},null,2)+'\n',{mode:0o600,flag:'wx'});
NODE
mv "$work/manifest.json" "$encrypted.manifest.json"
chmod 600 "$encrypted.manifest.json"

if [[ -n "${KEEL_BACKUP_S3_BUCKET:-}" ]]; then
  : "${KEEL_BACKUP_S3_ENDPOINT:?KEEL_BACKUP_S3_ENDPOINT required}"
  : "${KEEL_BACKUP_S3_REGION:?KEEL_BACKUP_S3_REGION required}"
  : "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID required}"
  : "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY required}"
  [[ "$KEEL_BACKUP_S3_ENDPOINT" == https://* || "${KEEL_BACKUP_ALLOW_INSECURE_TEST_ENDPOINT:-false}" == true ]] || { echo "remote_backup_endpoint_must_use_https" >&2; exit 2; }
  command -v aws >/dev/null 2>&1 || { echo "aws_cli_required" >&2; exit 127; }
  prefix="${KEEL_BACKUP_S3_PREFIX:-keel}/$KEEL_BACKUP_DATABASE_ID/$stamp"
  # Upload the manifest last; its presence is the remote commit marker.
  for file in "$encrypted" "$encrypted.sha256" "$encrypted.manifest.json"; do
    aws --endpoint-url "$KEEL_BACKUP_S3_ENDPOINT" --region "$KEEL_BACKUP_S3_REGION" s3 cp --only-show-errors "$file" "s3://$KEEL_BACKUP_S3_BUCKET/$prefix/$(basename "$file")"
  done
  echo "remote_backup_prefix=s3://$KEEL_BACKUP_S3_BUCKET/$prefix/"
fi

echo "encrypted_tenant_snapshot_backup_created=$encrypted"
