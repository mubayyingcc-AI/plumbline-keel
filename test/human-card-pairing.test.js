'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const p=require('../src/human-card-pairing');
test('challenge is random, bound to principal/card/tenant and short lived',()=>{
 const a=p.createPairingChallenge({tenantId:'tenant-1',principalId:'principal-1',cardId:'card-0001',counter:1,now:100000});
 const b=p.createPairingChallenge({tenantId:'tenant-1',principalId:'principal-1',cardId:'card-0001',counter:1,now:100000});
 assert.notEqual(a.challengeId,b.challengeId);assert.notEqual(a.nonce,b.nonce);
 assert.equal(a.nonceHash,p.hashNonce(a.nonce));assert.equal(Date.parse(a.expiresAt),220000);
 assert.match(a.message,/KEEL-HUMAN-CARD-PAIRING-V1/);
});
test('only a valid Ed25519 signature verifies',()=>{
 const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
 const challenge=p.createPairingChallenge({tenantId:'t',principalId:'p',cardId:'card-12345',counter:7});
 const signature=crypto.sign(null,Buffer.from(challenge.message),privateKey).toString('base64url');
 feature/human-card-cryptographic-pairing
 assert.equal(p.verifyPairingSignature({publicKeyPem:publicKey.export({type:'spki',format:'pem'}),message:challenge.message,signatureBase64url:signature}),true);

 const publicKeyPem=publicKey.export({type:'spki',format:'pem'});
 assert.equal(p.verifyPairingSignature({publicKeyPem,message:challenge.message,signatureBase64url:signature}),true);
 assert.match(p.fingerprintPublicKey(publicKeyPem),/^[a-f0-9]{64}$/);
 assert.equal(p.fingerprintPublicKey(publicKeyPem),crypto.createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex'));
 main
 assert.equal(p.verifyPairingSignature({publicKeyPem:publicKey.export({type:'spki',format:'pem'}),message:challenge.message+'tampered',signatureBase64url:signature}),false);
});
test('wrong key, malformed signature and non-Ed25519 key fail closed',()=>{
 const a=crypto.generateKeyPairSync('ed25519'),b=crypto.generateKeyPairSync('ed25519');
 const challenge=p.createPairingChallenge({tenantId:'t',principalId:'p',cardId:'card-12345',counter:1});
 const signature=crypto.sign(null,Buffer.from(challenge.message),a.privateKey).toString('base64url');
 const args={message:challenge.message,signatureBase64url:signature};
 assert.equal(p.verifyPairingSignature({...args,publicKeyPem:b.publicKey.export({type:'spki',format:'pem'})}),false);
 assert.equal(p.verifyPairingSignature({...args,publicKeyPem:a.publicKey.export({type:'spki',format:'pem'}),signatureBase64url:'bad'}),false);
 const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
 assert.equal(p.verifyPairingSignature({...args,publicKeyPem:rsa.publicKey.export({type:'spki',format:'pem'})}),false);
});
test('nonce validation and expiry fail closed',()=>{
 assert.throws(()=>p.hashNonce('bad'),/pairing_nonce_invalid/);
 assert.equal(p.isExpired(new Date(1000).toISOString(),1000),true);
 assert.equal(p.isExpired(new Date(2000).toISOString(),1000),false);
 assert.equal(p.isExpired('not-a-date',1000),true);
});
test('challenge inputs reject malformed identity and counter',()=>{
 assert.throws(()=>p.createPairingChallenge({tenantId:'bad\ntenant',principalId:'p',cardId:'c',counter:1}),/pairing_tenant_id_invalid/);
 assert.throws(()=>p.createPairingChallenge({tenantId:'t',principalId:'p',cardId:'c',counter:0}),/pairing_counter_invalid/);
});
