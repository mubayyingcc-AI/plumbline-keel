#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${PGSSLROOTCERT_B64:?PGSSLROOTCERT_B64 required for verified database TLS}"
cert="${TMPDIR:-/tmp}/keel-postgres-root.crt"
printf '%s' "$PGSSLROOTCERT_B64" | base64 --decode > "$cert"
grep -q -- '-----BEGIN CERTIFICATE-----' "$cert"
grep -q -- '-----END CERTIFICATE-----' "$cert"
chmod 0600 "$cert"
export PGSSLROOTCERT="$cert"
export PGSSLMODE=verify-full

exec bash /opt/keel/backup-postgres-tenant-snapshot.sh
