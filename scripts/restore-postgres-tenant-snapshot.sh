#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${KEEL_BACKUP_FILE:?KEEL_BACKUP_FILE required}"
: "${KEEL_BACKUP_AGE_IDENTITY_FILE:?KEEL_BACKUP_AGE_IDENTITY_FILE required}"
: "${KEEL_RESTORE_DATABASE_URL:?KEEL_RESTORE_DATABASE_URL required}"
: "${KEEL_RESTORE_CONFIRM:?Set RESTORE_TO_EMPTY_DATABASE after checking target}"
: "${KEEL_RESTORE_EXPECTED_DATABASE_ID:?Expected source database identity required}"
[[ "$KEEL_RESTORE_CONFIRM" == RESTORE_TO_EMPTY_DATABASE ]] || { echo "restore_confirmation_invalid" >&2; exit 2; }
[[ -f "$KEEL_BACKUP_FILE" && -f "$KEEL_BACKUP_AGE_IDENTITY_FILE" && -f "$KEEL_BACKUP_FILE.sha256" && -f "$KEEL_BACKUP_FILE.manifest.json" ]] || { echo "required_restore_file_missing" >&2; exit 2; }
mode="$(stat -c %a "$KEEL_BACKUP_AGE_IDENTITY_FILE")"
[[ "$mode" == 600 ]] || { echo "decryption_identity_must_be_mode_0600" >&2; exit 2; }
for bin in age age-keygen sha256sum tar psql node awk; do command -v "$bin" >/dev/null 2>&1 || { echo "missing_required_command:$bin" >&2; exit 127; }; done
(cd "$(dirname "$KEEL_BACKUP_FILE")" && sha256sum --check "$(basename "$KEEL_BACKUP_FILE").sha256")
recipient="$(age-keygen -y "$KEEL_BACKUP_AGE_IDENTITY_FILE")"
node - "$KEEL_BACKUP_FILE" "$KEEL_BACKUP_FILE.manifest.json" "$KEEL_RESTORE_EXPECTED_DATABASE_ID" "$recipient" <<'NODE'
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const [artifact,manifestPath,expectedDatabaseId,recipient]=process.argv.slice(2);
const m=JSON.parse(fs.readFileSync(manifestPath,'utf8')),bytes=fs.readFileSync(artifact);
const digest=crypto.createHash('sha256').update(bytes).digest('hex');
const fingerprint=crypto.createHash('sha256').update(recipient).digest('hex');
if(m.format!=='keel-encrypted-postgres-backup/v2'||m.databaseId!==expectedDatabaseId||m.artifact!==path.basename(artifact)||m.bytes!==bytes.length||m.sha256!==digest||m.recipientFingerprint!==fingerprint||!Number.isInteger(m.tenantCount)||m.tenantCount<1) {
 process.stderr.write('backup_manifest_identity_or_integrity_mismatch\n'); process.exit(1);
}
NODE
count="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')")"
[[ "$count" =~ ^0$ ]] || { echo "restore_target_not_empty:$count" >&2; exit 3; }
work="$(mktemp -d "${TMPDIR:-/tmp}/keel-restore.XXXXXXXX")"
trap 'rm -rf "$work"' EXIT
archive="$work/package.tar.gz"
age --decrypt --identity "$KEEL_BACKUP_AGE_IDENTITY_FILE" --output "$archive" "$KEEL_BACKUP_FILE"
test -s "$archive"
tar -tzf "$archive" | while IFS= read -r entry; do
  [[ "$entry" == package || "$entry" == package/* ]] || { echo "unsafe_backup_archive_path" >&2; exit 1; }
  [[ "$entry" != /* && "/$entry/" != *"/../"* ]] || { echo "unsafe_backup_archive_traversal" >&2; exit 1; }
done
if tar -tvzf "$archive" | awk '$1 !~ /^[-d]/ {bad=1} END {exit bad}'; then :; else echo "unsafe_backup_archive_entry_type" >&2; exit 1; fi
mkdir "$work/extracted"
tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$work/extracted"
package="$work/extracted/package"
[[ -d "$package" && -f "$package/PACKAGE-MANIFEST.json" && -f "$package/schema.sql" && -f "$package/global-data.sql" && -f "$package/sequences.sql" && -f "$package/tenant-ids.txt" && -f "$package/tenant-row-counts.tsv" && -f "$package/global-row-counts.tsv" && -f "$package/role-bootstrap.sql" && -f "$package/security-definer-owners.sql" && -f "$package/extensions.tsv" ]] || { echo "backup_package_incomplete" >&2; exit 4; }
node - "$package" "$KEEL_RESTORE_EXPECTED_DATABASE_ID" <<'NODE'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [root,expectedDatabaseId]=process.argv.slice(2),m=JSON.parse(fs.readFileSync(path.join(root,'PACKAGE-MANIFEST.json'),'utf8'));
if(m.format!=='keel-tenant-snapshot-package/v1'||m.databaseId!==expectedDatabaseId||!Number.isInteger(m.tenantCount)||m.tenantCount<1||!Array.isArray(m.files))throw Error('backup_package_manifest_invalid');
const expected=new Set();
for(const item of m.files){
 if(typeof item.path!=='string'||path.isAbsolute(item.path)||item.path.split(/[\\/]/).includes('..')||expected.has(item.path))throw Error('backup_package_path_invalid');
 expected.add(item.path);
 const file=path.join(root,item.path),st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.size!==item.bytes)throw Error('backup_package_file_metadata_mismatch:'+item.path);
 const digest=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 if(digest!==item.sha256)throw Error('backup_package_file_digest_mismatch:'+item.path);
}
const actual=[];
function walk(dir,rel=''){for(const e of fs.readdirSync(path.join(dir,rel),{withFileTypes:true})){const r=path.join(rel,e.name);if(e.isSymbolicLink())throw Error('backup_package_symlink_rejected');if(e.isDirectory())walk(dir,r);else if(r!=='PACKAGE-MANIFEST.json')actual.push(r);}}
walk(root);
if(actual.length!==expected.size||actual.some(x=>!expected.has(x)))throw Error('backup_package_file_set_mismatch');
const tenants=fs.readFileSync(path.join(root,'tenant-ids.txt'),'utf8').trim().split(/\r?\n/).filter(Boolean);
if(tenants.length!==m.tenantCount||new Set(tenants).size!==tenants.length||tenants.some(x=>!/^[0-9a-fA-F-]{36}$/.test(x)))throw Error('backup_package_tenant_coverage_invalid');
const tenantFiles=fs.readdirSync(path.join(root,'tenants')).filter(x=>/^tenant-[0-9]{6}\.sql$/.test(x));
if(tenantFiles.length!==m.tenantCount)throw Error('backup_package_tenant_export_count_mismatch');
NODE
while IFS=
[[ "$can_create_roles" == true ]] || { echo "restore_requires_superuser_or_createrole" >&2; exit 8; }
psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$package/role-bootstrap.sql"
psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$package/schema.sql"
psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$package/security-definer-owners.sql"
psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$package/global-data.sql"
while IFS= read -r tenant_file; do
  [[ -f "$tenant_file" ]] || { echo "tenant_export_missing" >&2; exit 5; }
  psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$tenant_file"
done < <(find "$package/tenants" -maxdepth 1 -type f -name 'tenant-*.sql' | sort)
psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$package/sequences.sql"
while IFS=$'\t' read -r tenant table expected_rows; do
  [[ "$tenant" =~ ^[0-9a-fA-F-]{36}$ && "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && "$expected_rows" =~ ^[0-9]+$ ]] || { echo "tenant_row_count_manifest_invalid" >&2; exit 9; }
  actual_rows="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.\"$table\" WHERE tenant_id='$tenant'")"
  [[ "$actual_rows" == "$expected_rows" ]] || { echo "tenant_row_count_mismatch:$tenant:$table expected=$expected_rows actual=$actual_rows" >&2; exit 9; }
done < "$package/tenant-row-counts.tsv"
while IFS=$'\t' read -r table expected_rows; do
  [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && "$expected_rows" =~ ^[0-9]+$ ]] || { echo "global_row_count_manifest_invalid" >&2; exit 9; }
  actual_rows="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.\"$table\"")"
  [[ "$actual_rows" == "$expected_rows" ]] || { echo "global_row_count_mismatch:$table expected=$expected_rows actual=$actual_rows" >&2; exit 9; }
done < "$package/global-row-counts.tsv"
expected="$(wc -l < "$package/tenant-ids.txt" | tr -d ' ')"
actual="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.keel_tenants")"
[[ "$actual" == "$expected" ]] || { echo "restored_tenant_count_mismatch:expected=$expected actual=$actual" >&2; exit 6; }
while IFS= read -r tenant; do
  found="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.keel_tenants WHERE tenant_id='$tenant'")"
  [[ "$found" == 1 ]] || { echo "restored_tenant_missing:$tenant" >&2; exit 6; }
done < "$package/tenant-ids.txt"
rls_missing="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND a.attnum>0 AND NOT a.attisdropped) AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)")"
[[ "$rls_missing" == 0 ]] || { echo "restored_tenant_rls_boundary_missing:$rls_missing" >&2; exit 7; }
bad_roles="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_roles WHERE (rolname IN ('keel_runtime','keel_backup','keel_backup_reader') AND (rolsuper OR rolbypassrls)) OR (rolname IN ('keel_auth_owner','keel_backup_audit_owner') AND (rolsuper OR NOT rolbypassrls OR rolcanlogin))")"
[[ "$bad_roles" == 0 ]] || { echo "restored_role_privilege_boundary_failed:$bad_roles" >&2; exit 10; }
bad_definers="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND p.prosecdef AND r.rolname NOT IN ('keel_auth_owner','keel_backup_audit_owner')")"
[[ "$bad_definers" == 0 ]] || { echo "restored_security_definer_owner_mismatch:$bad_definers" >&2; exit 11; }
bad_tenant_rows="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.keel_backup_tenant_integrity_audit() WHERE unassigned_rows>0 OR orphaned_rows>0")"
[[ "$bad_tenant_rows" == 0 ]] || { echo "restored_unassigned_or_orphaned_tenant_rows:$bad_tenant_rows" >&2; exit 12; }
echo "tenant_snapshot_restore_completed=true"
\\t' read -r extension version; do
  [[ "$extension" =~ ^[A-Za-z0-9_.-]+$ && "$version" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "backup_extension_manifest_invalid" >&2; exit 13; }
  available="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_available_extension_versions WHERE name='$extension' AND version='$version'")"
  [[ "$available" == 1 ]] || { echo "required_extension_version_unavailable:$extension:$version" >&2; exit 13; }
done < "$package/extensions.tsv"
can_create_roles="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT (rolsuper OR rolcreaterole)::text FROM pg_roles WHERE rolname=current_user")"
[[ "$can_create_roles" == true ]] || { echo "restore_requires_superuser_or_createrole" >&2; exit 8; }
psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$package/role-bootstrap.sql"
psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$package/schema.sql"
psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$package/security-definer-owners.sql"
psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$package/global-data.sql"
while IFS= read -r tenant_file; do
  [[ -f "$tenant_file" ]] || { echo "tenant_export_missing" >&2; exit 5; }
  psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$tenant_file"
done < <(find "$package/tenants" -maxdepth 1 -type f -name 'tenant-*.sql' | sort)
psql "$KEEL_RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$package/sequences.sql"
while IFS=$'\t' read -r tenant table expected_rows; do
  [[ "$tenant" =~ ^[0-9a-fA-F-]{36}$ && "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && "$expected_rows" =~ ^[0-9]+$ ]] || { echo "tenant_row_count_manifest_invalid" >&2; exit 9; }
  actual_rows="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.\"$table\" WHERE tenant_id='$tenant'")"
  [[ "$actual_rows" == "$expected_rows" ]] || { echo "tenant_row_count_mismatch:$tenant:$table expected=$expected_rows actual=$actual_rows" >&2; exit 9; }
done < "$package/tenant-row-counts.tsv"
while IFS=$'\t' read -r table expected_rows; do
  [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && "$expected_rows" =~ ^[0-9]+$ ]] || { echo "global_row_count_manifest_invalid" >&2; exit 9; }
  actual_rows="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.\"$table\"")"
  [[ "$actual_rows" == "$expected_rows" ]] || { echo "global_row_count_mismatch:$table expected=$expected_rows actual=$actual_rows" >&2; exit 9; }
done < "$package/global-row-counts.tsv"
expected="$(wc -l < "$package/tenant-ids.txt" | tr -d ' ')"
actual="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.keel_tenants")"
[[ "$actual" == "$expected" ]] || { echo "restored_tenant_count_mismatch:expected=$expected actual=$actual" >&2; exit 6; }
while IFS= read -r tenant; do
  found="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.keel_tenants WHERE tenant_id='$tenant'")"
  [[ "$found" == 1 ]] || { echo "restored_tenant_missing:$tenant" >&2; exit 6; }
done < "$package/tenant-ids.txt"
rls_missing="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND a.attnum>0 AND NOT a.attisdropped) AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)")"
[[ "$rls_missing" == 0 ]] || { echo "restored_tenant_rls_boundary_missing:$rls_missing" >&2; exit 7; }
bad_roles="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_roles WHERE (rolname IN ('keel_runtime','keel_backup','keel_backup_reader') AND (rolsuper OR rolbypassrls)) OR (rolname IN ('keel_auth_owner','keel_backup_audit_owner') AND (rolsuper OR NOT rolbypassrls OR rolcanlogin))")"
[[ "$bad_roles" == 0 ]] || { echo "restored_role_privilege_boundary_failed:$bad_roles" >&2; exit 10; }
bad_definers="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND p.prosecdef AND r.rolname NOT IN ('keel_auth_owner','keel_backup_audit_owner')")"
[[ "$bad_definers" == 0 ]] || { echo "restored_security_definer_owner_mismatch:$bad_definers" >&2; exit 11; }
bad_tenant_rows="$(psql "$KEEL_RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.keel_backup_tenant_integrity_audit() WHERE unassigned_rows>0 OR orphaned_rows>0")"
[[ "$bad_tenant_rows" == 0 ]] || { echo "restored_unassigned_or_orphaned_tenant_rows:$bad_tenant_rows" >&2; exit 12; }
echo "tenant_snapshot_restore_completed=true"
