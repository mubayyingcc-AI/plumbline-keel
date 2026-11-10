'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');

function quoteIdentifier(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}
function quoteLiteral(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}
function assertTarget() {
  if (process.env.KEEL_MIGRATION_TARGET === 'ci') return;
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' ||
      process.env.KEEL_ALLOW_STAGING_MIGRATIONS !== 'true') {
    throw new Error('ledger_migrations_refused_outside_explicit_staging_target');
  }
}
async function main() {
  assertTarget();
  const connectionString = process.env.DATABASE_URL || process.env.PG_ADMIN_URL;
  const runtimePassword = process.env.KEEL_RUNTIME_DB_PASSWORD;
  if (!connectionString) throw new Error('admin_database_url_required');
  if (!runtimePassword || runtimePassword.length < 16) throw new Error('runtime_database_password_required');
  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    max: 2,
    connectionTimeoutMillis: 10000
  });
  const client = await pool.connect();
  let locked = false;
  try {
    const ownerResult = await client.query('SELECT current_user AS owner');
    const owner = ownerResult.rows[0].owner;
    const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname='keel_runtime'");
    if (role.rowCount) {
      await client.query('ALTER ROLE keel_runtime WITH LOGIN PASSWORD ' + quoteLiteral(runtimePassword) + ' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT');
    } else {
      await client.query('CREATE ROLE keel_runtime LOGIN PASSWORD ' + quoteLiteral(runtimePassword) + ' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT');
    }

    await client.query("CREATE TABLE IF NOT EXISTS keel_tenants (tenant_id UUID PRIMARY KEY, tenant_name TEXT NOT NULL, tenant_slug TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    await client.query('CREATE TABLE IF NOT EXISTS keel_schema_migrations (version TEXT PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');

    await client.query('SELECT pg_advisory_lock($1,$2)', [73654, 12]);
    locked = true;
    for (const version of ['012_double_entry_ledger.sql', '013_ledger_posting_and_reservations.sql']) {
      const file = path.join(__dirname, '..', 'db', 'migrations', version);
      const sql = fs.readFileSync(file, 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const existing = await client.query('SELECT checksum FROM keel_schema_migrations WHERE version=$1', [version]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum.trim() !== checksum) throw new Error('applied_migration_checksum_mismatch:' + version);
        console.log('migration_already_applied ' + version);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO keel_schema_migrations(version,checksum) VALUES($1,$2)', [version, checksum]);
        await client.query('COMMIT');
        console.log('migration_applied ' + version);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    const roleName = quoteIdentifier('keel_runtime');
    const ownerName = quoteIdentifier(owner);
    await client.query('GRANT USAGE ON SCHEMA public TO ' + roleName);
    await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ' + roleName);
    await client.query('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ' + roleName);
    await client.query('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ' + roleName);
    await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE ' + ownerName + ' IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ' + roleName);
    await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE ' + ownerName + ' IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ' + roleName);
    await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE ' + ownerName + ' IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ' + roleName);

    const check = await client.query("SELECT rolsuper AS is_superuser, rolcreatedb AS can_create_database, rolcreaterole AS can_create_roles FROM pg_roles WHERE rolname='keel_runtime'");
    if (check.rows[0].is_superuser || check.rows[0].can_create_database || check.rows[0].can_create_roles) {
      throw new Error('runtime_role_privilege_boundary_failed');
    }
    console.log('runtime_role_ready keel_runtime (NOSUPERUSER, NOCREATEDB, NOCREATEROLE)');
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1,$2)', [73654, 12]).catch(() => {});
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error('staging_ledger_migration_failed', error.message);
  process.exitCode = 1;
});
