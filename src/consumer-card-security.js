'use strict';
const crypto=require('node:crypto');
const CARD_STATES=Object.freeze(['personalised_pending_attestation','attested_pending_delivery','delivered_pending_pairing','paired','locked','recovery_pending','replacement_required','revoked']);
const RECOVERY_MIN_DELAY_HOURS=24,RECOVERY_MAX_DELAY_HOURS=168,RECOVERY_MIN_TRUSTEES=2,RECOVERY_MAX_TRUSTEES=7;
function validHash(v){return typeof v==='string'&&/^[a-f0-9]{64}$/i.test(v);}
function normaliseCardKey(pem){
 if(typeof pem!=='string'||pem.length>4096)throw new Error('card_public_key_invalid');
 const key=crypto.createPublicKey(pem);
 if(key.asymmetricKeyType!=='ed25519')throw new Error('card_public_key_must_be_ed25519');
 return {pem,fingerprint:crypto.createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex')};
}
function verifySignedEvent({rawBody,timestamp,signature,secret,now=Date.now(),windowMs=300000}){
 if(!Buffer.isBuffer(rawBody)||rawBody.length>131072)throw new Error('event_body_invalid');
 if(typeof secret!=='string'||secret.length<32)throw new Error('event_verifier_not_configured');
 const ts=Number(timestamp);
 if(!Number.isSafeInteger(ts)||Math.abs(now-ts*1000)>windowMs)throw new Error('event_timestamp_out_of_range');
 const expected=crypto.createHmac('sha256',secret).update(String(ts)+'.').update(rawBody).digest();
 const supplied=String(signature||'').replace(/^sha256=/,'');
 if(!/^[a-f0-9]{64}$/i.test(supplied)||!crypto.timingSafeEqual(expected,Buffer.from(supplied,'hex')))throw new Error('event_signature_invalid');
 let body;try{body=JSON.parse(rawBody.toString('utf8'));}catch{throw new Error('event_json_invalid');}
 if(!body||Array.isArray(body)||typeof body!=='object')throw new Error('event_json_invalid');
 return body;
}
function validatePartnerPersonalisation(e,{partnerId}){
 if(e.partnerId!==partnerId||typeof e.eventId!=='string'||e.eventId.length<8||typeof e.orderId!=='string'||typeof e.cardReference!=='string'||e.cardReference.length<8)throw new Error('card_partner_event_invalid');
 if(e.status!=='personalised')throw new Error('card_partner_event_status_invalid');
 const key=normaliseCardKey(e.devicePublicKey);
 return Object.freeze({eventId:e.eventId,orderId:e.orderId,cardReferenceHash:crypto.createHash('sha256').update(e.cardReference).digest('hex'),devicePublicKey:key.pem,keyFingerprint:key.fingerprint});
}
function validateAttestation(e,{verifierId,now=Date.now()}){
 if(e.verifierId!==verifierId||typeof e.eventId!=='string'||typeof e.orderId!=='string'||typeof e.cardReference!=='string'||!validHash(e.attestationEvidenceHash)||!validHash(e.keyFingerprint)||e.verified!==true)throw new Error('hardware_attestation_invalid');
 const expires=Date.parse(e.expiresAt||'');
 if(!Number.isFinite(expires)||expires<=now||expires>now+366*86400000)throw new Error('hardware_attestation_expiry_invalid');
 if(!/^[A-Za-z0-9._-]{2,80}$/.test(String(e.hardwareModel||'')))throw new Error('hardware_model_invalid');
 return Object.freeze({eventId:e.eventId,orderId:e.orderId,cardReferenceHash:crypto.createHash('sha256').update(e.cardReference).digest('hex'),attestationEvidenceHash:e.attestationEvidenceHash.toLowerCase(),keyFingerprint:e.keyFingerprint.toLowerCase(),hardwareModel:e.hardwareModel,expiresAt:new Date(expires).toISOString()});
}
function validateDelivery(e,{verifierId}){
 if(e.verifierId!==verifierId||typeof e.eventId!=='string'||typeof e.orderId!=='string'||typeof e.cardReference!=='string'||e.status!=='delivered'||!validHash(e.deliveryEvidenceHash))throw new Error('delivery_evidence_invalid');
 return Object.freeze({eventId:e.eventId,orderId:e.orderId,cardReferenceHash:crypto.createHash('sha256').update(e.cardReference).digest('hex'),deliveryEvidenceHash:e.deliveryEvidenceHash.toLowerCase()});
}
function challenge({consumerId,cardId,counter,now=Date.now(),ttlMs=120000}){
 if(!Number.isSafeInteger(counter)||counter<1||!Number.isSafeInteger(now)||ttlMs<10000||ttlMs>300000)throw new Error('card_challenge_parameters_invalid');
 const challengeId=crypto.randomUUID(),nonce=crypto.randomBytes(32).toString('base64url'),expiresAt=new Date(now+ttlMs).toISOString();
 const message=['KEEL-CONSUMER-CARD-V1',consumerId,cardId,challengeId,nonce,String(counter),expiresAt].join('\n');
 return {challengeId,nonce,nonceHash:crypto.createHash('sha256').update(nonce).digest('hex'),counter,expiresAt,message};
}
function verifyProof({publicKeyPem,message,nonce,nonceHash,signature,expiresAt,now=Date.now()}){
 if(Date.parse(expiresAt)<=now||!nonce||crypto.createHash('sha256').update(nonce).digest('hex')!==nonceHash||typeof signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(signature))return false;
 try{return crypto.verify(null,Buffer.from(message),crypto.createPublicKey(publicKeyPem),Buffer.from(signature,'base64url'));}catch{return false;}
}
function validateRecoveryGroup({ownerId,trusteeIds,threshold,delayHours}){
 if(!Array.isArray(trusteeIds)||trusteeIds.length<RECOVERY_MIN_TRUSTEES||trusteeIds.length>RECOVERY_MAX_TRUSTEES||new Set(trusteeIds).size!==trusteeIds.length||trusteeIds.includes(ownerId))throw new Error('consumer_recovery_trustees_invalid');
 if(!Number.isInteger(threshold)||threshold<2||threshold>trusteeIds.length)throw new Error('consumer_recovery_threshold_invalid');
 if(!Number.isInteger(delayHours)||delayHours<RECOVERY_MIN_DELAY_HOURS||delayHours>RECOVERY_MAX_DELAY_HOURS)throw new Error('consumer_recovery_delay_invalid');
 return {ownerId,trusteeIds,threshold,delayHours};
}
function evaluateRecovery({status,decision,alreadyResponded,ownerId,trusteeId,approvals,threshold,now=Date.now(),eligibleAt}){
 if(status!=='pending')return {accepted:false,reason:'recovery_not_pending'};
 if(trusteeId===ownerId||alreadyResponded)return {accepted:false,reason:'trustee_not_independent_or_already_responded'};
 if(!['approve','reject'].includes(decision))throw new Error('recovery_decision_invalid');
 if(decision==='reject')return {accepted:true,status:'rejected'};
 const count=approvals+1;
 return {accepted:true,status:count>=threshold?'approved_waiting_period':'pending',approvalCount:count,eligibleAt:count>=threshold?new Date(now+24*60*60*1000).toISOString():null};
}
function isCardUsable(state){return state==='paired';}
module.exports={CARD_STATES,RECOVERY_MIN_DELAY_HOURS,RECOVERY_MAX_DELAY_HOURS,verifySignedEvent,validatePartnerPersonalisation,validateAttestation,validateDelivery,challenge,verifyProof,validateRecoveryGroup,evaluateRecovery,isCardUsable,normaliseCardKey,validHash};
