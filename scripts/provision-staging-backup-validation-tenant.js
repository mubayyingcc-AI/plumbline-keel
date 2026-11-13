'use strict';

const { Pool } = require('pg');

async function main() {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' ||
      process.env.KEEL_ALLOW_STAGING_MIGRATIONS !== 'true' ||
      process.env.KEEL_CREATE_BACKUP_TEST_TENANT !== 'true') {
    throw new Error('staging_backup_validation_tenant_creation_not_explicitly_enabled');
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('admin_database_url_required');

  const encoded = String(process.env.PGSSLROOTCERT_B64 || '').trim();
  const ca = Buffer.from(encoded, 'base64').toString('utf8');
  if (!ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) {
    throw new Error('verified_database_ca_bundle_required');
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: true, ca },
    max: 1,
    connectionTimeoutMillis: 10000
  });

  const tenantId = '7d6f6e2d-5f1e-4c6d-9d5a-1c7a3d022022';
  const tenantSlug = 'keel-backup-validation-staging';

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO public.keel_tenants (tenant_id, tenant_name, tenant_slug, status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantId, 'Keel Staging Backup Validation Tenant', tenantSlug]
      );
      const verify = await client.query(
        'SELECT tenant_id::text, tenant_slug FROM public.keel_tenants WHERE tenant_id=$1 AND tenant_slug=$2',
        [tenantId, tenantSlug]
      );
      if (verify.rowCount !== 1) throw new Error('staging_backup_validation_tenant_verification_failed');
      await client.query('COMMIT');
      console.log('staging_backup_validation_tenant_ready ' + tenantId);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  process.stderr.write((error && error.message ? error.message : 'staging_backup_validation_tenant_failed') + '\\n');
  process.exitCode = 1;
});
