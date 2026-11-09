'use strict';
const crypto=require('node:crypto');
function verifyConsumerSession(token,{publicKeyPem,issuer,audience,keyId,now=Math.floor(Date.now()/1000)}){
 if(typeof token!=='string'||token.length>8192)throw new Error('consumer_session_token_invalid');
 const parts=token.split('.');
 if(parts.length!==3||parts.some(x=>!x))throw new Error('consumer_session_token_malformed');
 let header,claims,signature;
 try{header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));signature=Buffer.from(parts[2],'base64url');}catch{throw new Error('consumer_session_token_malformed');}
 if(header.alg!=='RS256'||header.kid!==keyId||header.typ!=='JWT')throw new Error('consumer_session_signing_key_invalid');
 let valid=false;
 try{valid=crypto.verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),crypto.createPublicKey(publicKeyPem),signature);}catch{valid=false;}
 if(!valid)throw new Error('consumer_session_signature_invalid');
 if(claims.iss!==issuer)throw new Error('consumer_session_issuer_invalid');
 const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
 if(!aud.includes(audience))throw new Error('consumer_session_audience_invalid');
 if(typeof claims.sub!=='string'||!claims.sub.trim()||claims.sub.length>255)throw new Error('consumer_session_subject_invalid');
 if(!Number.isInteger(claims.exp)||claims.exp<=now)throw new Error('consumer_session_expired');
 if(!Number.isInteger(claims.iat)||claims.iat>now+60||claims.iat<now-900||claims.exp-claims.iat>900)throw new Error('consumer_session_lifetime_invalid');
 if(claims.nbf!==undefined&&(!Number.isInteger(claims.nbf)||claims.nbf>now))throw new Error('consumer_session_not_yet_valid');
 if(typeof claims.jti!=='string'||claims.jti.length<8||claims.jti.length>128)throw new Error('consumer_session_jti_required');
 return Object.freeze({issuer:claims.iss,subject:claims.sub,tokenId:claims.jti,issuedAt:claims.iat,expiresAt:claims.exp});
}
module.exports={verifyConsumerSession};
