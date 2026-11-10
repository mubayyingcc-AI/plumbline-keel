'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createCheckpoint,verifyCheckpoint}=require('../src/independent-proof-checkpoint');
const pair=crypto.generateKeyPairSync('ed25519');
const input={tenantId:'11111111-1111-4111-8111-111111111111',verifiedEvents:'12',headFingerprint:'a'.repeat(64),keyId:'keel-test-key-1',privateKey:pair.privateKey};
test('independent checkpoint verifies offline with public key only',()=>{const cp=createCheckpoint(input);const result=verifyCheckpoint(cp,pair.publicKey);assert.equal(result.valid,true);assert.equal(result.verifiedEvents,'12');});
test('checkpoint tampering is detected',()=>{const cp=createCheckpoint(input);assert.equal(verifyCheckpoint({...cp,headFingerprint:'b'.repeat(64)},pair.publicKey).valid,false);});
test('checkpoint signed by a different key is rejected',()=>{const cp=createCheckpoint(input),other=crypto.generateKeyPairSync('ed25519');assert.equal(verifyCheckpoint(cp,other.publicKey).valid,false);});
test('checkpoint requires Ed25519 keys and valid chain head',()=>{const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048});assert.throws(()=>createCheckpoint({...input,privateKey:rsa.privateKey}),/checkpoint_private_key_must_be_ed25519/);assert.throws(()=>createCheckpoint({...input,headFingerprint:'bad'}),/checkpoint_head_fingerprint_invalid/);});
test('empty tenant checkpoint requires a null chain head',()=>{const cp=createCheckpoint({...input,verifiedEvents:'0',headFingerprint:null});assert.equal(verifyCheckpoint(cp,pair.publicKey).valid,true);});

test('checkpoint PEM environment keys sign and verify independently',()=>{const privatePem=pair.privateKey.export({type:'pkcs8',format:'pem'}),publicPem=pair.publicKey.export({type:'spki',format:'pem'});const cp=createCheckpoint({...input,privateKey:privatePem});assert.equal(verifyCheckpoint(cp,publicPem).valid,true);});
