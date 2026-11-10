'use strict';
const crypto=require('node:crypto');
const {canonical}=require('./authority-chain');
const ALGORITHM='Ed25519';
function fail(code){const e=new Error(code);e.code=code;throw e;}
function keyObject(key,type){
 try{if(key instanceof crypto.KeyObject){if(type==='private'&&key.type!=='private')fail('checkpoint_private_key_invalid');if(type==='public'&&key.type!=='public')fail('checkpoint_public_key_invalid');return key;}return type==='private'?crypto.createPrivateKey(key):crypto.createPublicKey(key);}
 catch(_){fail('checkpoint_'+type+'_key_invalid');}
}
function assertEd25519(key,type){
 if(key.asymmetricKeyType!=='ed25519')fail('checkpoint_'+type+'_key_must_be_ed25519');
 return key;
}
function createCheckpoint({tenantId,verifiedEvents,headFingerprint,createdAt=new Date().toISOString(),databaseIdentity='unspecified',keyId,privateKey}){
 if(typeof tenantId!=='string'||!tenantId.trim())fail('checkpoint_tenant_required');
 if(!/^(0|[1-9][0-9]*)$/.test(String(verifiedEvents)))fail('checkpoint_sequence_invalid');
 if(verifiedEvents!=='0'&&!/^[a-f0-9]{64}$/.test(headFingerprint||''))fail('checkpoint_head_fingerprint_invalid');
 if(verifiedEvents==='0'&&headFingerprint!==null)fail('empty_checkpoint_head_must_be_null');
 if(!Number.isFinite(Date.parse(createdAt)))fail('checkpoint_timestamp_invalid');
 if(typeof keyId!=='string'||!keyId.trim()||keyId.length>128)fail('checkpoint_key_id_invalid');
 const signingKey=assertEd25519(keyObject(privateKey,'private'),'private');
 const body={schema:'keel-independent-proof-checkpoint/v1',algorithm:ALGORITHM,keyId,tenantId,verifiedEvents:String(verifiedEvents),headFingerprint,createdAt,databaseIdentity:String(databaseIdentity).slice(0,160)};
 const signature=crypto.sign(null,Buffer.from(canonical(body)),signingKey).toString('base64');
 return Object.freeze({...body,signature});
}
function verifyCheckpoint(checkpoint,publicKey){
 if(!checkpoint||typeof checkpoint!=='object'||Array.isArray(checkpoint))fail('checkpoint_object_required');
 const {signature,...body}=checkpoint;
 if(body.schema!=='keel-independent-proof-checkpoint/v1'||body.algorithm!==ALGORITHM)fail('checkpoint_schema_or_algorithm_invalid');
 if(typeof signature!=='string'||!signature.length)fail('checkpoint_signature_required');
 const key=assertEd25519(keyObject(publicKey,'public'),'public');
 let bytes;try{bytes=Buffer.from(signature,'base64');if(bytes.toString('base64')!==signature)fail('checkpoint_signature_encoding_invalid');}catch(_){fail('checkpoint_signature_encoding_invalid');}
 return {valid:crypto.verify(null,Buffer.from(canonical(body)),key,bytes),tenantId:body.tenantId,verifiedEvents:body.verifiedEvents,headFingerprint:body.headFingerprint,keyId:body.keyId,createdAt:body.createdAt};
}
module.exports={createCheckpoint,verifyCheckpoint,ALGORITHM};
