'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {databaseSslOptions}=require('../server');

test('PostgreSQL TLS verifies certificates by default',()=>{
 assert.deepEqual(databaseSslOptions({NODE_ENV:'production'}),{rejectUnauthorized:true});
});
test('production cannot disable PostgreSQL TLS verification',()=>{
 assert.throws(()=>databaseSslOptions({NODE_ENV:'production',PGSSLMODE:'disable'}),/database_tls_cannot_be_disabled_in_production/);
});
test('non-production local development can explicitly disable TLS',()=>{
 assert.equal(databaseSslOptions({NODE_ENV:'development',PGSSLMODE:'disable'}),false);
});
test('custom PostgreSQL CA is loaded for verified TLS',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const file=path.join(os.tmpdir(),'keel-test-root-ca.pem');
 fs.writeFileSync(file,'test-root-ca');
 try { assert.deepEqual(databaseSslOptions({NODE_ENV:'production',PGSSLROOTCERT:file}),{rejectUnauthorized:true,ca:'test-root-ca'}); }
 finally { fs.unlinkSync(file); }
});

test('inline base64 PostgreSQL CA bundle is loaded with certificate verification enabled',()=>{
 const ca='-----BEGIN CERTIFICATE-----\\nVEVTVA==\\n-----END CERTIFICATE-----\\n';
 const encoded=Buffer.from(ca,'utf8').toString('base64');
 assert.deepEqual(databaseSslOptions({NODE_ENV:'production',PGSSLROOTCERT_B64:encoded}),{rejectUnauthorized:true,ca});
});
test('invalid inline PostgreSQL CA bundle is rejected',()=>{
 assert.throws(()=>databaseSslOptions({NODE_ENV:'production',PGSSLROOTCERT_B64:'not-a-certificate'}),/database_ca_bundle_invalid/);
});
