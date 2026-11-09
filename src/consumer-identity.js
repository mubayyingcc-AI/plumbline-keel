'use strict';
const crypto=require('node:crypto');
function verifyProviderWebhook({rawBody,timestamp,signature,secret,nowMs=Date.now(),toleranceMs=300000}){
 if(!Buffer.isBuffer(rawBody)||rawBody.length>262144)throw new Error('webhook_body_invalid');
 if(typeof secret!=='string'||secret.length<32)throw new Error('webhook_secret_not_configured');
 const ts=Number(timestamp);
 if(!Number.isSafeInteger(ts)||Math.abs(nowMs-ts*1000)>toleranceMs)throw new Error('webhook_timestamp_out_of_range');
 const supplied=String(signature||'').replace(/^sha256=/,'');
 if(!/^[a-f0-9]{64}$/i.test(supplied))throw new Error('webhook_signature_invalid');
 const expected=crypto.createHmac('sha256',secret).update(String(ts)+'.').update(rawBody).digest();
 const actual=Buffer.from(supplied,'hex');
 if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))throw new Error('webhook_signature_mismatch');
 return Object.freeze({timestamp:ts,bodyHash:crypto.createHash('sha256').update(rawBody).digest('hex')});
}
function normalizeProviderIdentityResult(input){
 const states=new Set(['verified','rejected','review_required','expired']);
 if(!input||typeof input!=='object'||!states.has(input.status))throw new Error('identity_provider_result_invalid');
 if(!/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(String(input.provider||'')))throw new Error('identity_provider_invalid');
 for(const [field,max] of [['externalSubjectRef',255],['externalReference',255],['eventId',128]])if(typeof input[field]!=='string'||!input[field].trim()||input[field].length>max)throw new Error('identity_provider_'+field+'_invalid');
 if(!/^[a-f0-9]{64}$/i.test(String(input.evidenceHash||'')))throw new Error('identity_evidence_hash_invalid');
 const assurance=String(input.assurance||'');
 if(input.status==='verified'&&!['substantial','high'].includes(assurance))throw new Error('identity_assurance_insufficient');
 const verifiedAt=input.verifiedAt?new Date(input.verifiedAt):null;
 if(input.status==='verified'&&(!verifiedAt||!Number.isFinite(verifiedAt.getTime())))throw new Error('identity_verification_timestamp_required');
 const expiresAt=input.expiresAt?new Date(input.expiresAt):null;
 if(input.expiresAt&&(!expiresAt||!Number.isFinite(expiresAt.getTime())))throw new Error('identity_expiry_invalid');
 if(input.status==='verified'&&(!expiresAt||expiresAt<=verifiedAt))throw new Error('identity_expiry_required');
 return Object.freeze({provider:input.provider,externalSubjectRef:input.externalSubjectRef.trim(),externalReference:input.externalReference.trim(),eventId:input.eventId.trim(),status:input.status,assurance,evidenceHash:input.evidenceHash.toLowerCase(),verifiedAt:verifiedAt?verifiedAt.toISOString():null,expiresAt:expiresAt?expiresAt.toISOString():null});
}
module.exports={verifyProviderWebhook,normalizeProviderIdentityResult};
