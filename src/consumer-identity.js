'use strict';
const crypto=require('node:crypto');
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ASSURANCE=new Set(['substantial','high']);
function normalizeEmail(value){
 const email=String(value||'').trim().toLowerCase();
 if(email.length>254||!EMAIL.test(email))throw new Error('consumer_email_invalid');
 return email;
}
function normalizeVerifiedOidcIdentity({claims,issuer,audience,now=Math.floor(Date.now()/1000),cryptographicallyVerified=false,allowedAssurance=ALLOWED_ASSURANCE}){
 if(cryptographicallyVerified!==true)throw new Error('oidc_signature_verification_required');
 if(!claims||typeof claims!=='object'||Array.isArray(claims))throw new Error('oidc_claims_required');
 const iss=String(claims.iss||'').trim(),sub=String(claims.sub||'').trim();
 if(!iss||iss!==issuer||!sub||sub.length>255)throw new Error('oidc_issuer_or_subject_invalid');
 const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
 if(!aud.includes(audience))throw new Error('oidc_audience_invalid');
 if(!Number.isInteger(claims.exp)||claims.exp<=now)throw new Error('oidc_token_expired');
 if(!Number.isInteger(claims.iat)||claims.iat>now+60||now-claims.iat>600)throw new Error('oidc_token_time_invalid');
 if(claims.email_verified!==true)throw new Error('consumer_email_not_verified');
 const acr=String(claims.acr||'');
 if(!allowedAssurance.has(acr))throw new Error('consumer_authenticator_assurance_insufficient');
 const email=normalizeEmail(claims.email);
 return Object.freeze({issuer:iss,subject:sub,emailHash:crypto.createHash('sha256').update(email).digest('hex'),assurance:acr,authenticatedAt:new Date(claims.auth_time?claims.auth_time*1000:claims.iat*1000).toISOString(),tokenExpiresAt:new Date(claims.exp*1000).toISOString()});
}
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
 if(typeof input.externalReference!=='string'||!input.externalReference.trim()||input.externalReference.length>255)throw new Error('identity_provider_reference_invalid');
 if(!/^[a-f0-9]{64}$/i.test(String(input.evidenceHash||'')))throw new Error('identity_evidence_hash_invalid');
 const verifiedAt=input.verifiedAt?new Date(input.verifiedAt):null;
 if(input.status==='verified'&&(!verifiedAt||!Number.isFinite(verifiedAt.getTime())))throw new Error('identity_verification_timestamp_required');
 return Object.freeze({provider:input.provider,externalReference:input.externalReference.trim(),status:input.status,evidenceHash:input.evidenceHash.toLowerCase(),verifiedAt:verifiedAt?verifiedAt.toISOString():null,expiresAt:input.expiresAt?new Date(input.expiresAt).toISOString():null});
}
module.exports={normalizeEmail,normalizeVerifiedOidcIdentity,verifyProviderWebhook,normalizeProviderIdentityResult};
