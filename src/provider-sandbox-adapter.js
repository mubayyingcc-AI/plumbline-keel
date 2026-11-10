'use strict';
const crypto=require('node:crypto');const {verifyHmacSha256}=require('./provider-lifecycle');
const {canonical}=require('./authority-chain');
function fail(code,status=400){const e=new Error(code);e.code=code;e.status=status;throw e;}
class ProviderSandboxAdapter{
 constructor({providerId='keel-sandbox-bank',transport,keyring,activeKeyId}={}){
  if(!providerId||typeof transport!=='function'||!keyring||!activeKeyId)fail('sandbox_adapter_configuration_incomplete',503);
  this.providerId=providerId;this.transport=transport;this.keyring=new Map(Object.entries(keyring));this.activeKeyId=activeKeyId;
  if(!this.keyring.has(activeKeyId))fail('active_webhook_key_missing',503);
 }
 rotateWebhookKey({keyId,secret,retainPrevious=true}){
  if(!keyId||typeof secret!=='string'||Buffer.byteLength(secret)<32)fail('rotation_key_invalid');
  if(this.keyring.has(keyId))fail('rotation_key_id_already_exists',409);
  const previous=this.activeKeyId;this.keyring.set(keyId,secret);this.activeKeyId=keyId;if(!retainPrevious)this.keyring.delete(previous);
  return {activeKeyId:this.activeKeyId,retainedKeyIds:[...this.keyring.keys()]};
 }
 retireWebhookKey(keyId){if(keyId===this.activeKeyId)fail('cannot_retire_active_webhook_key',409);return this.keyring.delete(keyId);}
 async dispatch(instruction){
  if(!instruction||!instruction.idempotencyKey||!instruction.payload)fail('sandbox_instruction_invalid');
  const response=await this.transport({providerId:this.providerId,idempotencyKey:instruction.idempotencyKey,payload:instruction.payload});
  if(!response||!response.providerInstructionId||!['accepted','failed','unknown'].includes(response.outcome))fail('sandbox_transport_response_invalid',502);
  return Object.freeze({...response,providerId:this.providerId,idempotencyKey:instruction.idempotencyKey,sandbox:true});
 }
 verifyCallback({rawBody,signature,keyId,verifiedAt}){
  const secret=this.keyring.get(keyId);if(!secret)fail('provider_callback_key_unknown',403);
  const attestation=verifyHmacSha256({rawBody,signature,secret,keyId,verifiedAt});
  let event;try{event=JSON.parse(rawBody);}catch(_){fail('provider_callback_json_invalid',400);}
  if(event.providerId!==this.providerId)fail('provider_callback_provider_mismatch',403);
  return Object.freeze({event,attestation,sandbox:true});
 }
}
function createDeterministicSandboxTransport({outcome='accepted'}={}){
 const seen=new Map();return async ({providerId,idempotencyKey,payload})=>{
  const fingerprint=crypto.createHash('sha256').update(canonical(payload)).digest('hex');
  const prior=seen.get(idempotencyKey);
  if(prior){if(prior.echoFingerprint!==fingerprint)fail('sandbox_idempotency_payload_conflict',409);return {...prior,replayed:true};}
  const result={outcome,providerInstructionId:'sbx_'+crypto.createHash('sha256').update(providerId+':'+idempotencyKey).digest('hex').slice(0,24),echoFingerprint:fingerprint};
  seen.set(idempotencyKey,result);return {...result,replayed:false};
 };
}
module.exports={ProviderSandboxAdapter,createDeterministicSandboxTransport};
