'use strict';
const crypto=require('node:crypto');
const {canonical}=require('./authority-chain');
function fail(code,status=403){const e=new Error(code);e.code=code;e.status=status;throw e;}
function digest(v){return crypto.createHash('sha256').update(canonical(v)).digest('hex');}
const ACTIONS=new Set(['ledger:journal:post','ledger:reservation:create','ledger:reservation:release','ledger:reservation:consume','provider:instruction:enqueue','provider:instruction:dispatch']);
function normalizeEnvelope(input,grantorPrincipalId){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('authority_envelope_required',400);
 const granteePrincipalId=String(input.granteePrincipalId||'').trim();
 const scopes=Array.isArray(input.scopes)?[...new Set(input.scopes)]:[];
 if(!granteePrincipalId||!scopes.length||scopes.some(s=>typeof s!=='string'||!ACTIONS.has(s)))fail('authority_envelope_scope_invalid',400);
 const validFrom=input.validFrom||new Date().toISOString(),expiresAt=input.expiresAt;
 if(!Number.isFinite(Date.parse(validFrom))||!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=Date.parse(validFrom)||Date.parse(expiresAt)-Date.parse(validFrom)>90*86400000)fail('authority_envelope_time_invalid_or_over_90_days',400);
 if(input.resourceIds!==undefined&&(!Array.isArray(input.resourceIds)||input.resourceIds.some(x=>typeof x!=='string'||!x.trim()||x.length>180)))fail('authority_resource_scope_invalid',400);
 const resourceIds=Array.isArray(input.resourceIds)?[...new Set(input.resourceIds.map(x=>x.trim()))]:[];
 const currency=input.currency?String(input.currency).toUpperCase():null;
 if(currency&&!/^[A-Z]{3}$/.test(currency))fail('authority_currency_invalid',400);
 let maxAmountMinor=null;if(input.maxAmountMinor!==undefined&&input.maxAmountMinor!==null){if(typeof input.maxAmountMinor!=='string'||!/^(0|[1-9][0-9]*)$/.test(input.maxAmountMinor))fail('authority_amount_limit_invalid',400);maxAmountMinor=input.maxAmountMinor;}
 const approvalRequired=input.approvalRequired===true,approverPrincipalId=approvalRequired?String(input.approverPrincipalId||'').trim():null;
 if(approvalRequired&&!approverPrincipalId)fail('independent_approver_required',400);
 if(approverPrincipalId===granteePrincipalId||grantorPrincipalId===granteePrincipalId)fail('self_delegation_forbidden',400);
 if(maxAmountMinor!==null&&!currency)fail('authority_currency_required_for_amount_limit',400);
 return {grantorPrincipalId,granteePrincipalId,scopes,resourceIds,currency,maxAmountMinor,approvalRequired,approverPrincipalId,validFrom:new Date(validFrom).toISOString(),expiresAt:new Date(expiresAt).toISOString(),allowSubdelegation:false};
}
async function authorizeAndRecord(client,context){
 const {tenantId,actor,envelopeId,action,resourceId,amountMinor,currency,requestFingerprint,executionRef}=context;
 if(!actor||!actor.principal_id||!actor.key_id)fail('named_actor_principal_required');
 if(!ACTIONS.has(action))fail('financial_action_not_supported',400);
 if(!envelopeId)fail('authority_envelope_header_required');
 const principal=await client.query("SELECT p.principal_id FROM keel_principals p JOIN keel_tenant_keys k ON k.tenant_id=p.tenant_id AND k.principal_id=p.principal_id WHERE p.tenant_id=$1 AND p.principal_id=$2 AND p.status='active' AND k.key_id=$3 AND k.status='active' FOR SHARE OF p,k",[tenantId,actor.principal_id,actor.key_id]);
 if(!principal.rowCount)fail('actor_principal_or_key_inactive');
 const q=await client.query('SELECT * FROM keel_authority_envelopes WHERE tenant_id=$1 AND envelope_id=$2 FOR UPDATE',[tenantId,envelopeId]);
 if(!q.rowCount)fail('authority_envelope_not_found',404);
 const e=q.rows[0],reasons=[];
 const storedEnvelopeFingerprint=digest({grantorPrincipalId:e.grantor_principal_id,granteePrincipalId:e.grantee_principal_id,scopes:Array.isArray(e.scopes)?e.scopes:[],resourceIds:Array.isArray(e.resource_ids)?e.resource_ids:[],currency:e.currency,maxAmountMinor:e.max_amount_minor===null?null:String(e.max_amount_minor),approvalRequired:e.approval_required,approverPrincipalId:e.approver_principal_id,validFrom:new Date(e.valid_from).toISOString(),expiresAt:new Date(e.expires_at).toISOString(),allowSubdelegation:false});
 if(storedEnvelopeFingerprint!==String(e.envelope_fingerprint||'').trim())fail('authority_envelope_fingerprint_mismatch',409);
 if(e.status!=='active')reasons.push('ENVELOPE_NOT_ACTIVE');
 if(e.grantee_principal_id!==actor.principal_id)reasons.push('ACTOR_NOT_AUTHORIZED_GRANTEE');
 const now=Date.now();if(now<Date.parse(e.valid_from)||now>=Date.parse(e.expires_at))reasons.push('DELEGATION_NOT_CURRENT');
 const scopes=Array.isArray(e.scopes)?e.scopes:[];if(!scopes.includes(action))reasons.push('ACTION_OUTSIDE_ENVELOPE');
 const resources=Array.isArray(e.resource_ids)?e.resource_ids:[];if(!resources.length)reasons.push('RESOURCE_SCOPE_REQUIRED');else if(!resourceId||!resources.includes(resourceId))reasons.push('RESOURCE_OUTSIDE_ENVELOPE');
 if(amountMinor!==undefined&&amountMinor!==null){
  if(typeof amountMinor!=='string'||!/^(0|[1-9][0-9]*)$/.test(amountMinor))reasons.push('ACTION_AMOUNT_INVALID');
  else if(e.max_amount_minor!==null&&BigInt(amountMinor)>BigInt(e.max_amount_minor))reasons.push('AMOUNT_LIMIT_EXCEEDED');
  if(e.currency&&e.currency!==currency)reasons.push('CURRENCY_SCOPE_MISMATCH');
 }
 if(reasons.length)fail(reasons[0]);
 let approvals=[];
 if(e.approval_required){
  const a=await client.query("SELECT approval_id,approver_principal_id,decision FROM keel_authority_action_approvals WHERE tenant_id=$1 AND envelope_id=$2 AND request_fingerprint=$3 ORDER BY created_at",[tenantId,envelopeId,requestFingerprint]);
  approvals=a.rows;
  if(!approvals.some(x=>x.approver_principal_id===e.approver_principal_id&&x.approver_principal_id!==actor.principal_id&&x.decision==='approve'))fail('independent_action_approval_required',409);
 }
 const authority={envelopeId:e.envelope_id,grantorPrincipalId:e.grantor_principal_id,granteePrincipalId:e.grantee_principal_id,scopes,resourceIds:resources,currency:e.currency,maxAmountMinor:e.max_amount_minor===null?null:String(e.max_amount_minor),validFrom:new Date(e.valid_from).toISOString(),expiresAt:new Date(e.expires_at).toISOString(),approvalRequired:e.approval_required,approverPrincipalId:e.approver_principal_id,status:e.status};
 const authorityFingerprint=digest(authority),proofId=crypto.randomUUID();
 await client.query('INSERT INTO keel_action_proof_objects(tenant_id,proof_id,actor_key_id,actor_principal_id,envelope_id,action,resource_id,request_fingerprint,authority_fingerprint,decision,reason_codes,execution_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)',[tenantId,proofId,actor.key_id,actor.principal_id,envelopeId,action,resourceId||null,requestFingerprint,authorityFingerprint,'PERMIT',JSON.stringify(['WITHIN_SCOPED_DELEGATION',...(e.approval_required?['INDEPENDENT_APPROVAL_VERIFIED']:[])]),executionRef||null]);
 return {proofId,envelopeId,authorityFingerprint,requestFingerprint,decision:'PERMIT'};
}
module.exports={ACTIONS,normalizeEnvelope,authorizeAndRecord,digest};
