'use strict';
const crypto=require('node:crypto');
const VERSION='KEEL-HUMAN-CARD-PAIRING-V1';
const DEFAULT_TTL_MS=120000;
function required(value,name){
 if(typeof value!=='string'||!value.trim()||/[\r\n]/.test(value))throw new Error('pairing_'+name+'_invalid');
 return value.trim();
}
function createPairingChallenge({tenantId,principalId,cardId,counter,now=Date.now(),ttlMs=DEFAULT_TTL_MS}){
 const tenant=required(tenantId,'tenant_id'),principal=required(principalId,'principal_id'),card=required(cardId,'card_id');
 if(!Number.isSafeInteger(counter)||counter<1)throw new Error('pairing_counter_invalid');
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(ttlMs)||ttlMs<10000||ttlMs>300000)throw new Error('pairing_timing_invalid');
 const challengeId=crypto.randomUUID(),nonce=crypto.randomBytes(32).toString('base64url'),expiresAt=new Date(now+ttlMs).toISOString();
 const message=[VERSION,tenant,principal,card,challengeId,nonce,String(counter),expiresAt].join('\n');
 return {challengeId,nonce,nonceHash:crypto.createHash('sha256').update(nonce).digest('hex'),counter,expiresAt,message};
}
 feature/human-card-cryptographic-pairing

function fingerprintPublicKey(publicKeyPem){
 if(typeof publicKeyPem!=='string'||publicKeyPem.length>4096)throw new Error('pairing_public_key_invalid');
 const key=crypto.createPublicKey(publicKeyPem);
 if(key.asymmetricKeyType!=='ed25519')throw new Error('pairing_public_key_must_be_ed25519');
 const der=key.export({type:'spki',format:'der'});
 return crypto.createHash('sha256').update(der).digest('hex');
}
  main
function verifyPairingSignature({publicKeyPem,message,signatureBase64url}){
 if(typeof publicKeyPem!=='string'||publicKeyPem.length>4096)throw new Error('pairing_public_key_invalid');
 if(typeof message!=='string'||message.length>2048)throw new Error('pairing_message_invalid');
 if(typeof signatureBase64url!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(signatureBase64url))return false;
 let key,signature;
 try{key=crypto.createPublicKey(publicKeyPem);signature=Buffer.from(signatureBase64url,'base64url');}catch{return false;}
 if(key.asymmetricKeyType!=='ed25519'||signature.length!==64)return false;
 return crypto.verify(null,Buffer.from(message,'utf8'),key,signature);
}
function hashNonce(nonce){
 if(typeof nonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(nonce))throw new Error('pairing_nonce_invalid');
 return crypto.createHash('sha256').update(nonce).digest('hex');
}
function isExpired(expiresAt,now=Date.now()){
 const expiry=Date.parse(expiresAt);
 return !Number.isFinite(expiry)||expiry<=now;
}
  feature/human-card-cryptographic-pairing
module.exports={VERSION,DEFAULT_TTL_MS,createPairingChallenge,verifyPairingSignature,hashNonce,isExpired};

module.exports={VERSION,DEFAULT_TTL_MS,createPairingChallenge,fingerprintPublicKey,verifyPairingSignature,hashNonce,isExpired};
 main
