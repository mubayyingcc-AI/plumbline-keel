'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {verifySourceAttestation,signFixturePayload}=require('../src/source-attestation');
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const source={sourceId:'bank-feed:001',status:'active',publicKeyPem:publicKey.export({type:'spki',format:'pem'}),scopes:['cash_balance','collateral_position'],maxEvidenceAgeMs:3600000};
const now=new Date('2026-11-07T12:00:00Z');
function envelope(patch={}){const payload={tenantId:'tenant-001',sourceId:source.sourceId,evidenceId:'ev-001',sourceObjectRef:'account-001',objectFingerprint:'a'.repeat(64),observedAt:'2026-11-07T11:30:00Z',scope:'cash_balance',...patch};return {payload,signature:signFixturePayload(payload,privateKey.export({type:'pkcs8',format:'pem'}))};}
test('valid registered Ed25519 source signature verifies tenant-scoped payload',()=>{const r=verifySourceAttestation(envelope(),source,{tenantId:'tenant-001'},now);assert.equal(r.sourceAttested,true);assert.equal(r.evidenceStatus,'verified')});
test('tampered payload fails signature verification',()=>{const e=envelope();e.payload.objectFingerprint='b'.repeat(64);assert.throws(()=>verifySourceAttestation(e,source,{tenantId:'tenant-001'},now),/attestation_signature_invalid/)});
test('cross-tenant evidence is rejected',()=>assert.throws(()=>verifySourceAttestation(envelope(),source,{tenantId:'tenant-evil'},now),/tenant_scope_mismatch/));
test('inactive source cannot attest',()=>assert.throws(()=>verifySourceAttestation(envelope(),{...source,status:'revoked'},{tenantId:'tenant-001'},now),/source_not_active/));
test('source cannot attest outside registered scope',()=>assert.throws(()=>verifySourceAttestation(envelope({scope:'valuation'}),source,{tenantId:'tenant-001'},now),/source_scope_not_authorized/));
test('stale and future evidence are rejected',()=>{assert.throws(()=>verifySourceAttestation(envelope({observedAt:'2026-11-07T10:00:00Z'}),source,{tenantId:'tenant-001'},now),/attestation_stale/);assert.throws(()=>verifySourceAttestation(envelope({observedAt:'2026-11-07T13:00:00Z'}),source,{tenantId:'tenant-001'},now),/invalid_attestation_time/)});
test('source signature does not assert legal title or absence of undisclosed liens',()=>{const r=verifySourceAttestation(envelope(),source,{tenantId:'tenant-001'},now);assert.match(r.boundary,/does not independently prove legal title/);assert.match(r.boundary,/undisclosed liens/)});
test('RSA source keys are not accepted',()=>{const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048});assert.throws(()=>verifySourceAttestation(envelope(),{...source,publicKeyPem:rsa.publicKey.export({type:'spki',format:'pem'})},{tenantId:'tenant-001'},now),/source_key_must_be_ed25519/)});