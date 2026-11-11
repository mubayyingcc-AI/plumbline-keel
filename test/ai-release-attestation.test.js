'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {assessRelease}=require('../src/ai-release-assurance');
const {attestReleaseAssessment,verifyReleaseAttestation}=require('../src/ai-release-attestation');
const now='2026-11-11T00:00:00.000Z';
function record(){return assessRelease({releaseId:'rel-signed-1',tenantRef:'tenant-1',system:'agent-platform',environment:'staging',riskTier:'moderate',createdAt:now,changeRef:'change-1',
 components:[{componentId:'agent-runtime',kind:'agent',version:'2.1.0',fingerprint:'a'.repeat(64)}],
 requiredChecks:['safety','security'],checks:['safety','security'].map((category,i)=>({checkId:'c'+i,category,outcome:'passed',evidenceRef:'artifact://'+category,evidenceFingerprint:String(i+1).repeat(64),executedAt:now}))},new Date(now));}
test('Ed25519 attestation verifies a release assessment fingerprint',()=>{
 const pair=crypto.generateKeyPairSync('ed25519');
 const recordValue=record(),att=attestReleaseAssessment(recordValue,{keyId:'enterprise-ci-2026-01',privateKey:pair.privateKey,issuedAt:now});
 const verified=verifyReleaseAttestation(recordValue,att,pair.publicKey);
 assert.equal(verified.valid,true);assert.equal(verified.keyId,'enterprise-ci-2026-01');
});
test('attestation rejects a modified assessment',()=>{
 const pair=crypto.generateKeyPairSync('ed25519'),r=record();
 const att=attestReleaseAssessment(r,{keyId:'ci-key',privateKey:pair.privateKey,issuedAt:now});
 const modified={...r,release:{...r.release,system:'other-system'}};
 assert.equal(verifyReleaseAttestation(modified,att,pair.publicKey).reason,'release_assessment_proof_invalid');
});
test('attestation rejects a different public key',()=>{
 const a=crypto.generateKeyPairSync('ed25519'),b=crypto.generateKeyPairSync('ed25519'),r=record();
 const att=attestReleaseAssessment(r,{keyId:'ci-key',privateKey:a.privateKey,issuedAt:now});
 assert.equal(verifyReleaseAttestation(r,att,b.publicKey).valid,false);
});
test('attestation rejects a different release fingerprint',()=>{
 const pair=crypto.generateKeyPairSync('ed25519'),r=record();
 const att=attestReleaseAssessment(r,{keyId:'ci-key',privateKey:pair.privateKey,issuedAt:now});
 assert.equal(verifyReleaseAttestation(r,{...att,proofFingerprint:'f'.repeat(64)},pair.publicKey).reason,'attestation_release_mismatch');
});
test('attestation rejects non-Ed25519 keys',()=>{
 const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),r=record();
 assert.throws(()=>attestReleaseAssessment(r,{keyId:'ci-key',privateKey:pair.privateKey,issuedAt:now}),/attestation_key_must_be_ed25519/);
});
