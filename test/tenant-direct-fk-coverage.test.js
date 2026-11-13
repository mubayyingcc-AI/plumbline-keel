'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const databaseUrl = process.env.PG_ADMIN_URL || process.env.KEEL_LEDGER_TEST_DATABASE_URL;
const tables = [
  'keel_accounting_book_accounts',
  'keel_accounting_period_close_requests',
  'keel_accounting_period_closures',
  'keel_ledger_account_balances',
  'keel_ledger_lines',
  'keel_regulatory_mappings',
  'keel_regulatory_obligations'
];

test('finance and regulatory tenant tables have validated direct tenant registry foreign keys', { skip: !databaseUrl }, () => {
  const names = tables.map(name => "'" + name + "'").join(',');
  const sql = `
    SELECT count(*)
    FROM unnest(ARRAY[${names}]::text[]) AS expected(table_name)
    LEFT JOIN pg_class c ON c.relname=expected.table_name
    LEFT JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
    LEFT JOIN pg_attribute child_key ON child_key.attrelid=c.oid
      AND child_key.attname='tenant_id' AND child_key.attnum>0 AND NOT child_key.attisdropped
    WHERE c.oid IS NULL OR n.oid IS NULL OR child_key.attnum IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM pg_constraint fk
        JOIN pg_attribute parent_key ON parent_key.attrelid=fk.confrelid
          AND parent_key.attname='tenant_id' AND parent_key.attnum>0 AND NOT parent_key.attisdropped
        WHERE fk.conrelid=c.oid
          AND fk.confrelid='public.keel_tenants'::regclass
          AND fk.contype='f' AND fk.convalidated
          AND fk.conkey=ARRAY[child_key.attnum]::smallint[]
          AND fk.confkey=ARRAY[parent_key.attnum]::smallint[]
      )
  `;
  const result = spawnSync('psql', [databaseUrl, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), '0', 'one or more tenant tables lack a validated direct tenant foreign key');
});
