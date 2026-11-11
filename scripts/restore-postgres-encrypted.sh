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
[[ "$(stat -c %a "$KEEL_BACKUP_AGE_IDENTITY_FILE")" == 600 ]] || { echo "decryption_identity_must_be_mode_0600" >&2; exit 2; }
for bin in age age-keygen sha256sum psql node tar pg_restore; do command -v "$bin" >/dev/null 2>&1 || { echo "missing_required_command:$bin" >&2; exit 127; }; done

(cd "$(dirname "$KEEL_BACKUP_FILE")" && sha256sum --check "$(basename "$KEEL_BACKUP_FILE").sha256")
recipient="$(age-keygen -y "$KEEL_BACKUP_AGE_IDENTITY_FILE")"
node - "$KEEL_BACKUP_FILE" "${KEEL_BACKUP_FILE}.manifest.json" "$KEEL_RESTORE_EXPECTED_DATABASE_ID" "$recipient" <<'NODE'
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const [artifact,manifestPath,expectedDatabaseId,recipient]=process.argv.slice(2);
const m=JSON.parse(fs.readFileSync(manifestPath,'utf8')),bytes=fs.readFileSync(artifact);
const digest=crypto.createHash('sha256').update(bytes).digest('hex');
const recipientFingerprint=crypto.createHash('sha256').update(recipient).digest('hex');
if(!['keel-encrypted-postgres-backup/v1','keel-encrypted-postgres-backup/v2'].includes(m.format)||m.databaseId!==expectedDatabaseId||m.artifact!==path.basename(artifact)||m.bytes!==bytes.length||m.sha256!==digest||m.recipientFingerprint!==recipientFingerprint) {
 process.stderr.write('backup_manifest_identity_or_integrity_mismatch\n');process.exit(1);
}
NODE

format="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).format)' "${KEEL_BACKUP_FILE}.manifest.json")"
if [[ "$format" == "keel-encrypted-postgres-backup/v1" ]]; then
  count="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND c.relkind IN ('r','p','v','m','S','f')")"
  [[ "$count" =~ ^0$ ]] || { echo "restore_target_not_empty:$count" >&2; exit 3; }
  legacy_work="$(mktemp -d "${TMPDIR:-/tmp}/keel-legacy-restore.XXXXXXXX")"
  trap 'rm -rf "$legacy_work"' EXIT
  age --decrypt --identity "$KEEL_BACKUP_AGE_IDENTITY_FILE" --output "$legacy_work/restore.dump" "$KEEL_BACKUP_FILE"
  pg_restore --list "$legacy_work/restore.dump" >/dev/null
  pg_restore --exit-on-error --no-owner --no-acl --dbname="$KEEL_RESTORE_DATABASE_URL" "$legacy_work/restore.dump"
  echo "legacy_encrypted_restore_completed=true"
  exit 0
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/keel-restore.XXXXXXXX")"
trap 'rm -rf "$work"' EXIT
plain="$work/package.tar.gz"
age --decrypt --identity "$KEEL_BACKUP_AGE_IDENTITY_FILE" --output "$plain" "$KEEL_BACKUP_FILE"
test -s "$plain"
mkdir -m 700 "$work/unpacked"
tar -tzf "$plain" >"$work/archive.list"
tar -tvzf "$plain" >"$work/archive.verbose"
awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" { exit 1 }' "$work/archive.verbose" || { echo "backup_archive_links_or_special_files_forbidden" >&2; exit 4; }
node - "$work/archive.list" <<'NODE'
const fs=require('node:fs'),p=require('node:path');
for(const raw of fs.readFileSync(process.argv[2],'utf8').split(/\r?\n/).filter(Boolean)){
 const name=raw.replace(/\/$/,'');
 if(!name||name.startsWith('/')||name.split('/').some(x=>x==='..'||x===''))throw Error('unsafe_backup_archive_path');
 if(p.posix.normalize(name)!==name)throw Error('noncanonical_backup_archive_path');
}
NODE
tar --no-same-owner --no-same-permissions -xzf "$plain" -C "$work/unpacked"
package="$work/unpacked/package"
[[ -f "$package/PACKAGE-MANIFEST.json" && -f "$package/schema.sql" && -f "$package/global-data.sql" && -f "$package/sequences.sql" && -f "$package/coverage.tsv" && -f "$package/roles.tsv" && -f "$package/role-memberships.tsv" ]] || { echo "tenant_snapshot_package_incomplete" >&2; exit 4; }
node - "$package" "$KEEL_RESTORE_EXPECTED_DATABASE_ID" <<'NODE'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [dir,expectedId]=process.argv.slice(2),m=JSON.parse(fs.readFileSync(path.join(dir,'PACKAGE-MANIFEST.json'),'utf8'));
if(m.format!=='keel-tenant-snapshot-package/v2'||m.databaseId!==expectedId||!Number.isInteger(m.tenantCount)||m.tenantCount<1||!Array.isArray(m.files))throw Error('package_manifest_invalid');
const tenantFiles=fs.readdirSync(path.join(dir,'tenants')).filter(x=>/^tenant-[0-9]{6}\.sql$/.test(x));
if(tenantFiles.length!==m.tenantCount)throw Error('tenant_data_file_count_mismatch');
const seen=new Set();
for(const f of m.files){
 if(typeof f.path!=='string'||f.path.startsWith('/')||f.path.split(/[\\/]/).includes('..')||seen.has(f.path))throw Error('package_manifest_path_invalid');
 seen.add(f.path);
 const p=path.join(dir,f.path),b=fs.readFileSync(p);
 if(b.length!==f.bytes||crypto.createHash('sha256').update(b).digest('hex')!==f.sha256)throw Error('package_file_integrity_mismatch:'+f.path);
}
for(const required of ['schema.sql','global-data.sql','sequences.sql','coverage.tsv','roles.tsv','role-memberships.tsv'])if(!seen.has(required))throw Error('package_manifest_missing:'+required);
NODE

count="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND c.relkind IN ('r','p','v','m','S','f')")"
[[ "$count" =~ ^0$ ]] || { echo "restore_target_not_empty:$count" >&2; exit 3; }

# Recreate role names only. Login credentials are never included in backups.
while IFS=$'\t' read -r role canlogin inherit connlimit bypass; do
 [[ -n "$role" ]] || continue
 [[ "$role" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "invalid_role_name_in_backup" >&2; exit 78; }
 if [[ "$role" == "keel_auth_owner" ]]; then
   [[ "$canlogin" == "f" && "$bypass" == "t" ]] || { echo "auth_owner_role_metadata_invalid" >&2; exit 78; }
   psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c 'CREATE ROLE keel_auth_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS'
 elif [[ "$bypass" == "f" && "$canlogin" == "t" ]]; then
   psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "CREATE ROLE ""$role"" NOLOGIN INHERIT NOBYPASSRLS"
 elif [[ "$bypass" == "f" && "$canlogin" == "f" ]]; then
   psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "CREATE ROLE ""$role"" NOLOGIN INHERIT NOBYPASSRLS"
 else
   echo "backup_role_requires_manual_security_review:$role" >&2; exit 78
 fi
done <"$package/roles.tsv"

while IFS=$'\t' read -r granted member admin; do
 [[ -n "$granted" ]] || continue
 [[ "$granted" =~ ^[a-z_][a-z0-9_]*$ && "$member" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "invalid_role_membership_metadata" >&2; exit 78; }
 [[ "$granted" != "keel_auth_owner" ]] || { echo "auth_owner_membership_forbidden" >&2; exit 78; }
 psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "GRANT ""$granted"" TO ""$member"""
done <"$package/role-memberships.tsv"

psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$package/schema.sql"
psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$package/global-data.sql"
for tenant_file in "$package"/tenants/tenant-*.sql; do
 [[ -f "$tenant_file" ]] || { echo "tenant_data_file_missing" >&2; exit 4; }
 psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$tenant_file"
done
psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$package/sequences.sql"

# SECURITY DEFINER owners must be the dedicated narrow role, never the restore superuser.
psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
DO $restore$
BEGIN
  IF to_regclass('public.keel_tenants') IS NOT NULL THEN
    GRANT SELECT ON public.keel_tenants TO keel_auth_owner;
  END IF;
  IF to_regclass('public.keel_tenant_keys') IS NOT NULL THEN
    GRANT SELECT ON public.keel_tenant_keys TO keel_auth_owner;
    GRANT UPDATE(last_used_at) ON public.keel_tenant_keys TO keel_auth_owner;
  END IF;
  IF to_regclass('public.keel_principals') IS NOT NULL THEN
    GRANT SELECT ON public.keel_principals TO keel_auth_owner;
  END IF;
  IF to_regprocedure('public.keel_authenticate_tenant_key(text)') IS NOT NULL THEN
    ALTER FUNCTION public.keel_authenticate_tenant_key(TEXT) OWNER TO keel_auth_owner;
  END IF;
  IF to_regprocedure('public.keel_touch_tenant_key(text,uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.keel_touch_tenant_key(TEXT,UUID) OWNER TO keel_auth_owner;
  END IF;
  IF to_regprocedure('public.keel_backup_tenant_ids()') IS NOT NULL THEN
    ALTER FUNCTION public.keel_backup_tenant_ids() OWNER TO keel_auth_owner;
  END IF;
END
$restore$;
SQL

# Compare every recorded row count under the backup role's actual RLS view.
while IFS=$'\t' read -r scope tenant table expected actual; do
 [[ "$scope" == "scope" ]] && continue
 [[ "$table" =~ ^[a-z_][a-z0-9_]*$ && "$expected" =~ ^[0-9]+$ && "$actual" =~ ^[0-9]+$ && "$expected" == "$actual" ]] || { echo "coverage_manifest_invalid" >&2; exit 78; }
 if [[ "$scope" == "GLOBAL" ]]; then
   observed="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 -c "SET ROLE keel_backup; SELECT count(*) FROM public.""$table""")"
 elif [[ "$scope" == "TENANT" && "$tenant" =~ ^[0-9a-fA-F-]{36}$ ]]; then
   observed="$(PGOPTIONS="-c keel.tenant_id=$tenant" psql "$KEEL_RESTORE_DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 -c "SET ROLE keel_backup; SELECT count(*) FROM public.""$table""")"
 else
   echo "coverage_scope_invalid" >&2; exit 78
 fi
 [[ "$observed" == "$expected" ]] || { echo "restore_row_coverage_mismatch:$scope:$tenant:$table:$expected:$observed" >&2; exit 78; }
done <"$package/coverage.tsv"

echo "tenant_snapshot_restore_completed=true"
