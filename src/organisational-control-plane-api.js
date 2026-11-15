'use strict';
const {normalizeManifest,evaluateCapabilityRequest,digest}=require('./organisational-control-plane');
const authorityPersistence=require('./authority-persistence');
const ROOT='/api/control';
function reply(send,res,status,payload){send(res,status,payload);return true;}
async function handle(ctx){
 const {req,res,route,authenticateTenant,tenantScopedPool,dbPool,send,readBody,sameOriginIfBrowser,crypto}=ctx;
 if(!route.startsWith(ROOT+'/')||route.startsWith(ROOT+'/sandbox/'))return false;
 const actor=await authenticateTenant(req);if(!actor)return reply(send,res,401,{error:'valid_tenant_api_key_required'});
 const base=await dbPool();if(!base)return reply(send,res,503,{error:'control_plane_storage_unavailable'});
 const pool=tenantScopedPool(base,actor.tenant_id);if(!pool)return reply(send,res,503,{error:'control_plane_storage_unavailable'});
 if(req.method==='GET'&&route===ROOT+'/integrations'){
  const q=await pool.query('SELECT capability_id,integration_id,provider_id,principal_id,display_name,integration_version,manifest,manifest_fingerprint,status,created_at,revoked_at FROM public.keel_integration_capabilities WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',[actor.tenant_id]);
  return reply(send,res,200,{count:q.rowCount,integrations:q.rows});
 }
 if(req.method==='POST'&&route===ROOT+'/integrations'){
  if(!sameOriginIfBrowser(req))return reply(send,res,403,{error:'origin_not_allowed'});
  if(!['owner','admin'].includes(actor.role)||!actor.principal_id)return reply(send,res,403,{error:'named_tenant_admin_required'});
  const body=await readBody(req),manifest=normalizeManifest(body);
  const principal=await pool.query("SELECT principal_id,principal_kind,status FROM public.keel_principals WHERE tenant_id=$1 AND principal_id=$2",[actor.tenant_id,manifest.principalId]);
  if(!principal.rowCount||principal.rows[0].status!=='active')return reply(send,res,404,{error:'active_integration_principal_not_found'});
  if(!['ai_agent','service'].includes(principal.rows[0].principal_kind))return reply(send,res,400,{error:'integration_principal_must_be_agent_or_service'});
  const capabilityId=crypto.randomUUID();
  const inserted=await pool.query('INSERT INTO public.keel_integration_capabilities(tenant_id,capability_id,integration_id,provider_id,principal_id,display_name,integration_version,manifest,manifest_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) ON CONFLICT(tenant_id,integration_id,manifest_fingerprint) DO NOTHING RETURNING capability_id,created_at',[actor.tenant_id,capabilityId,manifest.integrationId,manifest.providerId,manifest.principalId,manifest.displayName,manifest.version,JSON.stringify(manifest),manifest.manifestFingerprint]);
  if(!inserted.rowCount)return reply(send,res,409,{error:'integration_manifest_already_registered'});
  return reply(send,res,201,{ok:true,capabilityId,manifest,createdAt:inserted.rows[0].created_at,execution:'NOT_EXECUTED'});
 }
 if(req.method==='POST'&&route===ROOT+'/integrations/revoke'){
  if(!sameOriginIfBrowser(req))return reply(send,res,403,{error:'origin_not_allowed'});
  if(!['owner','admin'].includes(actor.role)||!actor.principal_id)return reply(send,res,403,{error:'named_tenant_admin_required'});
  const body=await readBody(req),integrationId=String(body.integrationId||'').trim();if(!integrationId)return reply(send,res,400,{error:'integration_id_required'});
  const q=await pool.query("UPDATE public.keel_integration_capabilities SET status='revoked',revoked_at=NOW() WHERE tenant_id=$1 AND integration_id=$2 AND status='active' RETURNING capability_id",[actor.tenant_id,integrationId]);
  return reply(send,res,q.rowCount?200:404,{ok:q.rowCount>0,revokedCount:q.rowCount});
 }
 if(req.method==='GET'&&route===ROOT+'/actions'){
  const q=await pool.query('SELECT request_id,capability_id,principal_id,envelope_id,operation,resource_id,resource_type,payload_fingerprint,request_fingerprint,decision,status,proof_id,created_at,updated_at FROM public.keel_control_action_requests WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',[actor.tenant_id]);
  return reply(send,res,200,{count:q.rowCount,actions:q.rows,execution:'NOT_EXECUTED'});
 }
 if(req.method==='POST'&&route===ROOT+'/actions/evaluate'){
  if(!sameOriginIfBrowser(req))return reply(send,res,403,{error:'origin_not_allowed'});
  if(!actor.principal_id||actor.role!=='integration')return reply(send,res,403,{error:'named_integration_principal_required'});
  const body=await readBody(req);
  const integrationId=String(body.integrationId||'').trim(),operation=String(body.operation||'').trim(),resourceId=String(body.resourceId||'').trim(),resourceType=String(body.resourceType||'').trim(),envelopeId=String(body.envelopeId||req.headers['x-keel-authority-envelope']||'').trim(),amountMinor=body.amountMinor,currency=body.currency===undefined?undefined:String(body.currency).toUpperCase();
  if(!integrationId||!operation||!resourceId||!resourceType||!envelopeId||!body.payload||typeof body.payload!=='object'||Array.isArray(body.payload))return reply(send,res,400,{error:'integration_operation_resource_payload_and_authority_envelope_required'});
  const q=await pool.query("SELECT * FROM public.keel_integration_capabilities WHERE tenant_id=$1 AND integration_id=$2 AND principal_id=$3 AND status='active' ORDER BY created_at DESC LIMIT 1",[actor.tenant_id,integrationId,actor.principal_id]);
  if(!q.rowCount)return reply(send,res,403,{error:'active_integration_registration_not_found'});
  const registration=q.rows[0],manifest=registration.manifest;
  if(!manifest)return reply(send,res,409,{error:'registered_manifest_fingerprint_mismatch'});
  const recomputed=normalizeManifest(manifest);
  if(recomputed.manifestFingerprint!==registration.manifest_fingerprint||manifest.manifestFingerprint!==registration.manifest_fingerprint)return reply(send,res,409,{error:'registered_manifest_fingerprint_mismatch'});
  const envelope=await pool.query('SELECT status,approval_required,approver_principal_id,max_amount_minor,currency FROM public.keel_authority_envelopes WHERE tenant_id=$1 AND envelope_id=$2',[actor.tenant_id,envelopeId]);
  if(!envelope.rowCount)return reply(send,res,404,{error:'authority_envelope_not_found'});
  if(envelope.rows[0].status!=='active')return reply(send,res,403,{ok:false,decision:'DENY',reasonCodes:['AUTHORITY_ENVELOPE_NOT_ACTIVE'],execution:'NOT_EXECUTED'});
  if(amountMinor!==undefined&&(typeof amountMinor!=='string'||!/^(0|[1-9][0-9]*)$/.test(amountMinor)))return reply(send,res,400,{error:'amount_minor_must_be_an_exact_integer_string'});
  if(amountMinor!==undefined&&(!currency||body.payload.amountMinor!==amountMinor||String(body.payload.currency||'').toUpperCase()!==currency))return reply(send,res,400,{error:'amount_and_currency_must_match_the_canonical_action_payload'});
  if(amountMinor===undefined&&currency!==undefined)return reply(send,res,400,{error:'currency_without_amount_minor_forbidden'});
  if(currency!==undefined&&!/^[A-Z]{3}$/.test(currency))return reply(send,res,400,{error:'currency_must_be_an_iso_alpha3_code'});
  if(envelope.rows[0].max_amount_minor!==null&&(amountMinor===undefined||!currency))return reply(send,res,400,{error:'authority_amount_limit_requires_exact_amount_minor_and_currency'});
  const capability=evaluateCapabilityRequest({registration,tenantId:actor.tenant_id,actorPrincipalId:actor.principal_id,operation,resourceType});
  const payloadFingerprint=digest(body.payload);
  const requestMaterial={tenantId:actor.tenant_id,capabilityId:registration.capability_id,manifestFingerprint:registration.manifest_fingerprint,principalId:actor.principal_id,envelopeId,operation,resourceId,resourceType,payloadFingerprint,amountMinor:amountMinor===undefined?null:amountMinor,currency:currency===undefined?null:currency};
  const requestFingerprint=digest(requestMaterial),requestId=crypto.randomUUID();
  const persistDenied=async reasonCodes=>{
   const denied=await pool.query("INSERT INTO public.keel_control_action_requests(tenant_id,request_id,capability_id,principal_id,envelope_id,operation,resource_id,resource_type,payload_fingerprint,request_fingerprint,decision,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DENY','denied') ON CONFLICT(tenant_id,request_fingerprint) DO NOTHING RETURNING request_id",[actor.tenant_id,requestId,registration.capability_id,actor.principal_id,envelopeId,operation,resourceId,resourceType,payloadFingerprint,requestFingerprint]);
   if(denied.rowCount)await pool.query('INSERT INTO public.keel_control_action_events(tenant_id,event_id,request_id,event_type,event_fingerprint,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[actor.tenant_id,crypto.randomUUID(),requestId,'ACTION_DENIED',digest({requestFingerprint,reasonCodes,event:'ACTION_DENIED'}),JSON.stringify({requestFingerprint,reasonCodes,operation,resourceId})]);
   return reply(send,res,403,{ok:false,decision:'DENY',reasonCodes,requestFingerprint,execution:'NOT_EXECUTED'});
  };
  if(capability.decision==='DENY')return persistDenied(capability.reasonCodes);
  if(envelope.rows[0].max_amount_minor!==null&&BigInt(amountMinor)>BigInt(envelope.rows[0].max_amount_minor))return persistDenied(['AMOUNT_LIMIT_EXCEEDED']);
  if(envelope.rows[0].currency&&currency&&envelope.rows[0].currency!==currency)return persistDenied(['CURRENCY_SCOPE_MISMATCH']);
  const needsApproval=capability.decision==='REQUIRE_APPROVAL'||envelope.rows[0].approval_required===true;
  if(capability.decision==='REQUIRE_APPROVAL'&&(!envelope.rows[0].approval_required||!envelope.rows[0].approver_principal_id))return reply(send,res,409,{ok:false,decision:'REQUIRE_APPROVAL',reasonCodes:['CAPABILITY_REQUIRES_APPROVAL_BUT_ENVELOPE_HAS_NO_INDEPENDENT_APPROVER'],requestFingerprint,execution:'NOT_EXECUTED'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   let existing=await client.query('SELECT request_id,status FROM public.keel_control_action_requests WHERE tenant_id=$1 AND request_fingerprint=$2 FOR UPDATE',[actor.tenant_id,requestFingerprint]);
   let currentRequestId=existing.rowCount?existing.rows[0].request_id:requestId;
   if(existing.rowCount&&['authorized','denied','cancelled'].includes(existing.rows[0].status)){await client.query('ROLLBACK');return reply(send,res,409,{error:'action_request_terminal',status:existing.rows[0].status,requestId:currentRequestId});}
   if(needsApproval){
    const approvals=await client.query("SELECT approver_principal_id,decision FROM public.keel_authority_action_approvals WHERE tenant_id=$1 AND envelope_id=$2 AND request_fingerprint=$3",[actor.tenant_id,envelopeId,requestFingerprint]);
    const approved=approvals.rows.some(x=>x.approver_principal_id===envelope.rows[0].approver_principal_id&&x.approver_principal_id!==actor.principal_id&&x.decision==='approve');
    const rejected=approvals.rows.some(x=>x.approver_principal_id===envelope.rows[0].approver_principal_id&&x.decision==='reject');
    if(rejected){
     if(existing.rowCount)await client.query("UPDATE public.keel_control_action_requests SET decision='DENY',status='denied',updated_at=NOW() WHERE tenant_id=$1 AND request_id=$2",[actor.tenant_id,currentRequestId]);
     else await client.query("INSERT INTO public.keel_control_action_requests(tenant_id,request_id,capability_id,principal_id,envelope_id,operation,resource_id,resource_type,payload_fingerprint,request_fingerprint,decision,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DENY','denied')",[actor.tenant_id,currentRequestId,registration.capability_id,actor.principal_id,envelopeId,operation,resourceId,resourceType,payloadFingerprint,requestFingerprint]);
     await client.query('COMMIT');return reply(send,res,403,{ok:false,decision:'DENY',reasonCodes:['INDEPENDENT_HUMAN_REJECTED'],requestFingerprint,execution:'NOT_EXECUTED'});
    }
    if(!approved){
     if(!existing.rowCount)await client.query("INSERT INTO public.keel_control_action_requests(tenant_id,request_id,capability_id,principal_id,envelope_id,operation,resource_id,resource_type,payload_fingerprint,request_fingerprint,decision,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'REQUIRE_APPROVAL','awaiting_approval')",[actor.tenant_id,currentRequestId,registration.capability_id,actor.principal_id,envelopeId,operation,resourceId,resourceType,payloadFingerprint,requestFingerprint]);
     if(!existing.rowCount)await client.query('INSERT INTO public.keel_control_action_events(tenant_id,event_id,request_id,event_type,event_fingerprint,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[actor.tenant_id,crypto.randomUUID(),currentRequestId,'ACTION_HELD_FOR_APPROVAL',digest({requestFingerprint,event:'ACTION_HELD_FOR_APPROVAL'}),JSON.stringify({requestFingerprint,operation,resourceId,reason:'independent_human_approval_required'})]);
     await client.query('COMMIT');
     return reply(send,res,202,{ok:true,decision:'REQUIRE_APPROVAL',requestId:currentRequestId,requestFingerprint,approvalEndpoint:'/api/assurance/authority/approvals',approvalMustBindExactFingerprint:true,execution:'NOT_EXECUTED'});
    }
   }
   const proof=await authorityPersistence.authorizeAndRecord(client,{tenantId:actor.tenant_id,actor,envelopeId,action:'integration:tool:invoke',resourceId,additionalResourceIds:['integration:'+integrationId],amountMinor,currency,requestFingerprint,executionRef:currentRequestId});
   if(existing.rowCount)await client.query("UPDATE public.keel_control_action_requests SET decision='PERMIT',status='authorized',proof_id=$3,updated_at=NOW() WHERE tenant_id=$1 AND request_id=$2",[actor.tenant_id,currentRequestId,proof.proofId]);
   else await client.query("INSERT INTO public.keel_control_action_requests(tenant_id,request_id,capability_id,principal_id,envelope_id,operation,resource_id,resource_type,payload_fingerprint,request_fingerprint,decision,status,proof_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PERMIT','authorized',$11)",[actor.tenant_id,currentRequestId,registration.capability_id,actor.principal_id,envelopeId,operation,resourceId,resourceType,payloadFingerprint,requestFingerprint,proof.proofId]);
   await client.query('INSERT INTO public.keel_control_action_events(tenant_id,event_id,request_id,event_type,event_fingerprint,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[actor.tenant_id,crypto.randomUUID(),currentRequestId,'ACTION_AUTHORIZED',digest({requestFingerprint,proofId:proof.proofId,event:'ACTION_AUTHORIZED'}),JSON.stringify({requestFingerprint,proofId:proof.proofId,operation,resourceId})]);
   await client.query('COMMIT');
   return reply(send,res,200,{ok:true,decision:'PERMIT',requestId:currentRequestId,requestFingerprint,proof,execution:'NOT_EXECUTED',notice:'Authorization evidence only. No external plugin action was performed and no execution token was issued.'});
  }catch(error){
   await client.query('ROLLBACK').catch(()=>{});
   if(error.status===400||error.status===403){
    const denied=await pool.query("INSERT INTO public.keel_control_action_requests(tenant_id,request_id,capability_id,principal_id,envelope_id,operation,resource_id,resource_type,payload_fingerprint,request_fingerprint,decision,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DENY','denied') ON CONFLICT(tenant_id,request_fingerprint) DO UPDATE SET decision='DENY',status='denied',updated_at=NOW() RETURNING request_id",[actor.tenant_id,requestId,registration.capability_id,actor.principal_id,envelopeId,operation,resourceId,resourceType,payloadFingerprint,requestFingerprint]);
    await pool.query('INSERT INTO public.keel_control_action_events(tenant_id,event_id,request_id,event_type,event_fingerprint,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[actor.tenant_id,crypto.randomUUID(),denied.rows[0].request_id,'ACTION_DENIED',digest({requestFingerprint,reason:error.code||'AUTHORITY_DENIED',event:'ACTION_DENIED'}),JSON.stringify({requestFingerprint,reason:error.code||'AUTHORITY_DENIED',operation,resourceId})]);
    return reply(send,res,403,{ok:false,decision:'DENY',reasonCodes:[error.code||'AUTHORITY_DENIED'],requestFingerprint,execution:'NOT_EXECUTED'});
   }
   throw error;
  }finally{client.release();}
 }
 return reply(send,res,405,{error:'method_not_allowed'});
}
module.exports={handle,ROOT};
