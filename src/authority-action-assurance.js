'use strict';
const crypto=require('node:crypto');const {canonical}=require('./authority-chain');
const ACTIONS=new Set(['read','prepare','initiate','approve','release','reverse','change_beneficiary','change_policy','manage_credentials']);
function reject(code){const e=new Error(code);e.code=code;throw e;}
function normalizeEnvelope(e){
 if(!e||typeof e!=='object'||Array.isArray(e))reject('authority_envelope_required');
 const scopes=Array.isArray(e.scopes)?[...new Set(e.scopes)]:[];
 if(!e.tenantId||!e.grantorId||!e.granteeId||!scopes.length)reject('authority_envelope_incomplete');
 if(scopes.some(s=>typeof s!=='string'||!s.trim()||s.length>120))reject('authority_scope_invalid');
 if(e.grantorId===e.granteeId)reject('self_delegation_forbidden');
 const issued=Date.parse(e.issuedAt),expires=Date.parse(e.expiresAt);
 if(!Number.isFinite(issued)||!Number.isFinite(expires))reject('authority_time_invalid');
 if(expires<=issued)reject('authority_expiry_must_follow_issue');
 if(e.status!=='active')reject('authority_not_active');
 if(e.maxAmountMinor!==undefined&&(!/^(0|[1-9][0-9]*)$/.test(String(e.maxAmountMinor))))reject('authority_amount_cap_invalid');
 if(e.maxAmountMinor!==undefined&&!e.currency)reject('authority_currency_required_for_amount_cap');
 if(e.allowSubdelegation===true)reject('subdelegation_not_supported');
 return {...e,scopes,issuedAt:new Date(issued).toISOString(),expiresAt:new Date(expires).toISOString()};
}
function evaluateAction({envelope,actorId,tenantId,action,resource,amountMinor,currency,now=new Date().toISOString(),approvals=[]}){
 if(!ACTIONS.has(action))return {outcome:'DENY',reasonCodes:['ACTION_NOT_RECOGNIZED']};
 let e;try{e=normalizeEnvelope(envelope);}catch(err){return {outcome:'DENY',reasonCodes:[err.code||err.message]};}
 const reasons=[],time=Date.parse(now);
 if(!Number.isFinite(time))reasons.push('DECISION_TIME_INVALID');
 if(e.tenantId!==tenantId)reasons.push('TENANT_SCOPE_MISMATCH');
 if(e.granteeId!==actorId)reasons.push('ACTOR_NOT_DELEGATE');
 if(time<Date.parse(e.issuedAt)||time>=Date.parse(e.expiresAt))reasons.push('DELEGATION_NOT_CURRENT');
 if(!e.scopes.includes(action)&&!e.scopes.includes('*'))reasons.push('ACTION_OUTSIDE_DELEGATION');
 if(e.resourceIds&&(!resource||!e.resourceIds.includes(resource)))reasons.push('RESOURCE_OUTSIDE_DELEGATION');
 if(amountMinor!==undefined){
  if(typeof amountMinor!=='string'||!/^(0|[1-9][0-9]*)$/.test(amountMinor))reasons.push('AMOUNT_INVALID');
  else if(e.maxAmountMinor!==undefined&&BigInt(amountMinor)>BigInt(e.maxAmountMinor))reasons.push('AMOUNT_LIMIT_EXCEEDED');
  if(e.currency&&e.currency!==currency)reasons.push('CURRENCY_SCOPE_MISMATCH');
 }
 if(reasons.length)return {outcome:'DENY',reasonCodes:reasons};
 if(e.approvalRequired===true&&!approvals.some(a=>a&&a.principalId===e.approverId&&a.principalId!==actorId&&a.decision==='approve'))return {outcome:'REQUIRE_APPROVAL',reasonCodes:['INDEPENDENT_APPROVAL_REQUIRED']};
 return {outcome:'PERMIT',reasonCodes:['WITHIN_DELEGATED_AUTHORITY'],authorityFingerprint:crypto.createHash('sha256').update(canonical(e)).digest('hex')};
}
function detectConsequenceConflicts(grants){
 const grouped=new Map();
 for(const g of grants){const key=String(g.actorId)+'|'+String(g.resourceId||'*');if(!grouped.has(key))grouped.set(key,{actorId:g.actorId,resourceId:g.resourceId,capabilities:new Set()});for(const c of g.capabilities||[])grouped.get(key).capabilities.add(c);}
 const rules=[['read_beneficiaries','initiate_payment','BENEFICIARY_READ_AND_PAYMENT_INITIATION','critical'],['change_beneficiary','release_payment','BENEFICIARY_CHANGE_AND_PAYMENT_RELEASE','critical'],['manage_credentials','initiate_payment','CREDENTIAL_CONTROL_AND_PAYMENT_INITIATION','critical'],['change_policy','approve','POLICY_CHANGE_AND_APPROVAL','high']];
 const findings=[];for(const g of grouped.values())for(const [a,b,code,severity] of rules)if(g.capabilities.has(a)&&g.capabilities.has(b))findings.push({actorId:g.actorId,resourceId:g.resourceId,code,severity});return findings;
}
