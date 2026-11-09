'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const s=require('../src/consumer-card-security');
const secret='consumer-card-security-webhook-secret-32-bytes-minimum';
function sign(obj,ts=Math.floor(Date.now()/1000)){const raw=Buffer.from(JSON.stringify(obj));return {raw,signature:crypto.createHmac('sha256',secret).update(String(ts)+'.').update(raw).digest('hex'),timestamp:String(ts)};}
test('partner webhooks bind timestamp and exact raw body with timing-safe HMAC',()=>{
 const body={partnerId:'issuer-partner',eventId:'event-123456',orderId:crypto.randomUUID(),cardReference:'opaque-card-ref',status:'personalised',devicePublicKey:crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'})};
 const v=sign(body);assert.deepEqual(s.verifySignedEvent({rawBody:v.raw,timestamp:v.timestamp,signature:v.signature,secret}),body);
 assert.throws(()=>s.verifySignedEvent({rawBody:v.raw,timestamp:String(Number(v.timestamp)-1000),signature:v.signature,secret}),/timestamp_out_of_range/);
 assert.throws(()=>s.verifySignedEvent({rawBody:v.raw,timestamp:v.timestamp,signature:'0'.repeat(64),secret}),/signature_invalid/);
});
test('personalisation only accepts Ed25519 secure-element public keys and hashes partner references',()=>{
 const key=crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
 const e=s.validatePartnerPersonalisation({partnerId:'p',eventId:'event-123456',orderId:'o',cardReference:'private-ref',status:'personalised',devicePublicKey:key},{partnerId:'p'});
 assert.match(e.keyFingerprint,/^[a-f0-9]{64}$/);assert.notEqual(e.cardReferenceHash,'private-ref');
 const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'pem'});
 assert.throws(()=>s.validatePartnerPersonalisation({partnerId:'p',eventId:'event-123456',orderId:'o',cardReference:'ref',status:'personalised',devicePublicKey:rsa},{partnerId:'p'}),/ed25519/);
});
test('hardware attestation requires independent verifier, matching key fingerprint, evidence hash and expiry',()=>{
 const key=crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}),finger=s.normaliseCardKey(key).fingerprint;
 const e={verifierId:'lab-a',eventId:'attest-123',orderId:'o',cardReference:'ref',verified:true,attestationEvidenceHash:'a'.repeat(64),keyFingerprint:finger,hardwareModel:'KeelSecureV1',expiresAt:new Date(Date.now()+86400000).toISOString()};
 assert.equal(s.validateAttestation(e,{verifierId:'lab-a'}).keyFingerprint,finger);
 assert.throws(()=>s.validateAttestation({...e,verifierId:'partner'}, {verifierId:'lab-a'}),/attestation_invalid/);
 assert.throws(()=>s.validateAttestation({...e,expiresAt:new Date(Date.now()-1).toISOString()},{verifierId:'lab-a'}),/expiry_invalid/);
});
test('delivery proof requires independent verifier and a hashed evidence reference',()=>{
 const e={verifierId:'carrier-a',eventId:'delivery-123',orderId:'o',cardReference:'ref',status:'delivered',deliveryEvidenceHash:'b'.repeat(64)};
 assert.equal(s.validateDelivery(e,{verifierId:'carrier-a'}).deliveryEvidenceHash,'b'.repeat(64));
 assert.throws(()=>s.validateDelivery({...e,verifierId:'partner'},{verifierId:'carrier-a'}),/delivery_evidence_invalid/);
});
test('consumer card pairing proof is nonce-bound, short-lived and Ed25519-only',()=>{
 const pair=crypto.generateKeyPairSync('ed25519'),pub=pair.publicKey.export({type:'spki',format:'pem'});
 const ch=s.challenge({consumerId:'consumer',cardId:'card',counter:1,now:100000});
 const sig=crypto.sign(null,Buffer.from(ch.message),pair.privateKey).toString('base64url');
 assert.equal(s.verifyProof({publicKeyPem:pub,message:ch.message,nonce:ch.nonce,nonceHash:ch.nonceHash,signature:sig,expiresAt:ch.expiresAt,now:100001}),true);
 assert.equal(s.verifyProof({publicKeyPem:pub,message:ch.message,nonce:ch.nonce+'x',nonceHash:ch.nonceHash,signature:sig,expiresAt:ch.expiresAt,now:100001}),false);
 assert.equal(s.verifyProof({publicKeyPem:pub,message:ch.message,nonce:ch.nonce,nonceHash:ch.nonceHash,signature:sig,expiresAt:ch.expiresAt,now:ch.expiresAt?Date.parse(ch.expiresAt):999999}),false);
});
test('recovery requires 2-7 distinct current-identity trustee identifiers and bounded delay',()=>{
 const ids=[1,2,3].map(()=>crypto.randomUUID()),owner=crypto.randomUUID();
 assert.equal(s.validateRecoveryGroup({ownerId:owner,trusteeIds:ids,threshold:2,delayHours:24}).threshold,2);
 assert.throws(()=>s.validateRecoveryGroup({ownerId:owner,trusteeIds:[ids[0]],threshold:1,delayHours:24}),/trustees_invalid/);
 assert.throws(()=>s.validateRecoveryGroup({ownerId:owner,trusteeIds:[owner,ids[0]],threshold:2,delayHours:24}),/trustees_invalid/);
 assert.throws(()=>s.validateRecoveryGroup({ownerId:owner,trusteeIds:ids,threshold:2,delayHours:1}),/delay_invalid/);
});
test('only independent trustee approvals count; rejection blocks recovery',()=>{
 const owner=crypto.randomUUID(),trustee=crypto.randomUUID();
 assert.equal(s.evaluateRecovery({status:'pending',decision:'approve',alreadyResponded:false,ownerId:owner,trusteeId:owner,approvals:0,threshold:2}).accepted,false);
 assert.equal(s.evaluateRecovery({status:'pending',decision:'reject',alreadyResponded:false,ownerId:owner,trusteeId:trustee,approvals:0,threshold:2}).status,'rejected');
 assert.equal(s.evaluateRecovery({status:'pending',decision:'approve',alreadyResponded:false,ownerId:owner,trusteeId:trustee,approvals:1,threshold:2,now:0}).status,'approved_waiting_period');
});
test('only paired card is usable; lost-card state fails closed',()=>{assert.equal(s.isCardUsable('paired'),true);for(const x of ['locked','recovery_pending','revoked','delivered_pending_pairing'])assert.equal(s.isCardUsable(x),false);});
