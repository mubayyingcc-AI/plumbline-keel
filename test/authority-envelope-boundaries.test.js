'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeEnvelope}=require('../src/authority-persistence');
const grantor='00000000-0000-4000-8000-000000000001',grantee='00000000-0000-4000-8000-000000000002';
const base={granteePrincipalId:grantee,scopes:['ledger:journal:post'],expiresAt:'2026-12-01T00:00:00.000Z'};
test('authority envelope cannot exceed ninety days',()=>assert.throws(()=>normalizeEnvelope({...base,expiresAt:'2027-04-01T00:00:00.000Z'},grantor),/authority_envelope_time_invalid_or_over_90_days/));
test('resource scopes must be non-empty strings',()=>assert.throws(()=>normalizeEnvelope({...base,resourceIds:['account:cash',{}]},grantor),/authority_resource_scope_invalid/));
