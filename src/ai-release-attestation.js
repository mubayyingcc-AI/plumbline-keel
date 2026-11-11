'use strict';
const crypto=require('node:crypto');
const {canonical}=require('./authority-chain');
const {verifyReleaseAssessment}=require('./ai-release-assurance');

function fail(code){throw Object.assign(new Error(code),{code});}
function ed25519Key(value,type){
 let key;
 try{key=type==='private'?crypto.createPrivateKey(value):crypto.createPublicKey(value);}catch{fail('attestation_'+type+'_key_invalid');}
 if(key.asymmetricKeyType!=='ed25519')fail('attestation_key_must_be_ed25519');
 if(type==='private'&&key.type!=='private')fail('attestation_private_key_required');
 if(type==='public'&&key.type!=='public')fail('attestation_public_key_required');
 return key;
}
function payloadOf(attestation){
 return {schemaVersion:attestation.schemaVersion,algorithm:attestation.algorithm,keyId:attestation.keyId,
  issuedAt:attestation.issuedAt,proofFingerprint:attestation.proofFingerprint};
}
function attestReleaseAssessment(record,{keyId,privateKey,issuedAt=new Date().toISOString()}){
 const proof=verifyReleaseAssessment(record);
 if(!proof.valid)fail('release_assessment_proof_invalid');
 if(typeof keyId!=='string'||!keyId.trim()||keyId.length>160)fail('attestation_key_id_invalid');
 const time=Date.parse(issuedAt);if(!Number.isFinite(time))fail('attestation_timestamp_invalid');
 const body={schemaVersion:'keel-ai-release-attestation/v1',algorithm:'Ed25519',keyId:keyId.trim(),
  issuedAt:new Date(time).toISOString(),proofFingerprint:record.proofFingerprint};
 const signature=crypto.sign(null,Buffer.from(canonical(body),'utf8'),ed25519Key(privateKey,'private')).toString('base64url');
 return Object.freeze({...body,signature});
}
function verifyReleaseAttestation(record,attestation,publicKey){
 const proof=verifyReleaseAssessment(record);
 if(!proof.valid)return {valid:false,reason:'release_assessment_proof_invalid'};
 if(!attestation||typeof attestation!=='object'||Array.isArray(attestation))return {valid:false,reason:'attestation_required'};
 if(attestation.schemaVersion!=='keel-ai-release-attestation/v1'||attestation.algorithm!=='Ed25519')return {valid:false,reason:'attestation_schema_invalid'};
 if(typeof attestation.keyId!=='string'||!attestation.keyId.trim()||attestation.keyId.length>160)return {valid:false,reason:'attestation_key_id_invalid'};
 if(!Number.isFinite(Date.parse(attestation.issuedAt)))return {valid:false,reason:'attestation_timestamp_invalid'};
 if(attestation.proofFingerprint!==record.proofFingerprint)return {valid:false,reason:'attestation_release_mismatch'};
 if(typeof attestation.signature!=='string'||!/^[A-Za-z0-9_-]{80,120}$/.test(attestation.signature))return {valid:false,reason:'attestation_signature_invalid'};
 let valid=false;
 try{valid=crypto.verify(null,Buffer.from(canonical(payloadOf(attestation)),'utf8'),ed25519Key(publicKey,'public'),Buffer.from(attestation.signature,'base64url'));}catch{return {valid:false,reason:'attestation_key_invalid'};}
 return {valid,reason:valid?'valid':'attestation_signature_mismatch',keyId:attestation.keyId,issuedAt:attestation.issuedAt,proofFingerprint:attestation.proofFingerprint};
}
module.exports={attestReleaseAssessment,verifyReleaseAttestation};
