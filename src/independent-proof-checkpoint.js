'use strict';
const crypto=require('node:crypto');const {canonical}=require('./authority-chain');
function fail(code){const e=new Error(code);e.code=code;throw e;}
function hash(value){return crypto.createHash('sha256').update(value).digest('hex');}
function createKeyPair(){return crypto.generateKeyPairSync('ed25519');}
function createCheckpoint({tenantId,sequence,previousCheckpointHash=null,ledgerHeadFingerprint,providerWatermark,createdAt=new Date().toISOString(),privateKey,keyId}){
 if(!tenantId||!Number.isSafeInteger(sequence)||sequence<1||!ledgerHeadFingerprint||!privateKey||!keyId)fail('checkpoint_input_incomplete');
 if(!Number.isFinite(Date.parse(createdAt)))fail('checkpoint_timestamp_invalid');
 const body={schema:'keel-independent-checkpoint/v1',tenantId,sequence,previousCheckpointHash,ledgerHeadFingerprint,providerWatermark:providerWatermark||{},createdAt:new Date(createdAt).toISOString(),keyId};
 const signature=crypto.sign(null,Buffer.from(canonical(body)),privateKey).toString('base64');
 const checkpointHash=hash(canonical({body,signature}));
 return Object.freeze({...body,signature,checkpointHash});
}
function verifyCheckpoint(checkpoint,{publicKey,expectedPreviousHash,expectedTenantId}={}){
 if(!checkpoint||checkpoint.schema!=='keel-independent-checkpoint/v1')return {valid:false,reason:'CHECKPOINT_SCHEMA_INVALID'};
 const {signature,checkpointHash,...body}=checkpoint;
 if(expectedTenantId&&body.tenantId!==expectedTenantId)return {valid:false,reason:'TENANT_MISMATCH'};
 if(expectedPreviousHash!==undefined&&body.previousCheckpointHash!==expectedPreviousHash)return {valid:false,reason:'CHECKPOINT_CHAIN_MISMATCH'};
 if(!publicKey)return {valid:false,reason:'TRUSTED_PUBLIC_KEY_REQUIRED'};
 let valid=false;try{valid=crypto.verify(null,Buffer.from(canonical(body)),publicKey,Buffer.from(signature,'base64'));}catch(_){}
 if(!valid)return {valid:false,reason:'SIGNATURE_INVALID'};
 if(hash(canonical({body,signature}))!==checkpointHash)return {valid:false,reason:'CHECKPOINT_HASH_MISMATCH'};
 return {valid:true,checkpointHash,tenantId:body.tenantId,sequence:body.sequence,ledgerHeadFingerprint:body.ledgerHeadFingerprint};
}
module.exports={createKeyPair,createCheckpoint,verifyCheckpoint};
