'use strict';
const crypto=require('node:crypto');
const ROLES=new Set(['owner','admin','reviewer','analyst','integration']);
function required(value,field,max=160){
 if(typeof value!=='string'||!value.trim()||value.trim().length>max) throw new Error(field+' is required and must be at most '+max+' characters');
 return value.trim();
}
function normalizePrincipal(input){
 if(!input||typeof input!=='object') throw new Error('principal details required');
 const displayName=required(input.displayName,'displayName',160);
 const email=required(input.email,'email',254).toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('email must be valid');
 const externalSubject=typeof input.externalSubject==='string'?input.externalSubject.trim().slice(0,200):null;
 return {displayName,email,externalSubject};
}
function normalizeDelegation(input,actorPrincipalId){
 if(!input||typeof input!=='object') throw new Error('delegation details required');
 const granteePrincipalId=required(input.granteePrincipalId,'granteePrincipalId',80);
 if(granteePrincipalId===actorPrincipalId) throw new Error('self_delegation_not_allowed');
 const scopes=Array.isArray(input.scopes)?[...new Set(input.scopes.map(x=>required(x,'scope',80)))]:[];
 if(!scopes.length||scopes.some(x=>!['docket:review','docket:approve','evidence:export'].includes(x))) throw new Error('delegation scopes are invalid');
 const expiresAt=new Date(input.expiresAt);
 if(!Number.isFinite(expiresAt.getTime())||expiresAt<=new Date()||expiresAt-new Date()>90*86400000) throw new Error('delegation expiry must be within the next 90 days');
 return {granteePrincipalId,scopes,expiresAt:expiresAt.toISOString()};
}
function approvalDecision(input){
 if(!input||!['approve','reject'].includes(input.decision)) throw new Error('decision must be approve or reject');
 return {decision:input.decision,rationale:required(input.rationale,'rationale',2000)};
}
function exportManifest(input){
 const payload={schema:'keel-evidence-export-1.0',tenantId:input.tenantId,exportedAt:new Date().toISOString(),docket:input.docket,chainVerification:input.chainVerification,limitations:['This export reflects records held by the tenant in Plumbline Keel.','A valid hash chain does not independently prove source truth, legal title, priority, or external notarization.','Approval records show authenticated principal actions, not legal authority outside configured institutional policy.']};
 payload.manifestFingerprint=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 return payload;
}
module.exports={ROLES,normalizePrincipal,normalizeDelegation,approvalDecision,exportManifest};
