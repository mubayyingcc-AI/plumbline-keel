'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const sec=require('../src/tenant-security');
test('tenant identity is normalized and slug constrained',()=>{assert.deepEqual(sec.normalizeTenant({name:'Example Bank',slug:'example-bank'}),{name:'Example Bank',slug:'example-bank'});assert.throws(()=>sec.normalizeTenant({name:'X',slug:'Bad Slug'}))});
test('tenant keys are random, prefixed and stored as hashes',()=>{const a=sec.issueTenantKey(),b=sec.issueTenantKey();assert.ok(a.token.startsWith('kk_live_'));assert.notEqual(a.token,b.token);assert.equal(sec.hashPresentedKey(a.token),a.tokenHash);assert.notEqual(a.tokenHash,a.token)});
test('authorization parser rejects malformed credentials',()=>{const a=sec.issueTenantKey();assert.equal(sec.keyFromAuthorization('Bearer '+a.token),a.token);assert.equal(sec.keyFromAuthorization('Bearer wrong'),null);assert.equal(sec.keyFromAuthorization('Basic '+a.token),null)});
test('hash comparison is constant-time and exact',()=>{const a=sec.issueTenantKey();assert.equal(sec.safeHashEqual(a.tokenHash,a.tokenHash),true);assert.equal(sec.safeHashEqual(a.tokenHash,'0'.repeat(64)),false);assert.equal(sec.safeHashEqual('bad',a.tokenHash),false)});
test('tenant query scope only accepts safe SQL aliases',()=>{assert.equal(sec.tenantScopeSql('d'),'d.tenant_id = $1');assert.throws(()=>sec.tenantScopeSql('d; DROP TABLE x'))});
