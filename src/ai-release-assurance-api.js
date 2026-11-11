'use strict';
const {assessRelease}=require('./ai-release-assurance');

const COLLECTION='/api/ai/release-assessments';
const ITEM=new RegExp('^'+COLLECTION.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/([0-9a-f-]{36})$','i');
const WRITE_ROLES=new Set(['owner','admin','integration']);
function reply(send,res,status,payload){send(res,status,payload);return true;}

async function handle(ctx){
 const {req,res,route,authenticateTenant,tenantScopedPool,dbPool,send,readBody,sameOriginIfBrowser,crypto}=ctx;
 if(route!==COLLECTION&&!ITEM.test(route))return false;
 if(!['GET','POST'].includes(req.method))return reply(send,res,405,{error:'method_not_allowed'});
 if(req.method==='POST'&&!sameOriginIfBrowser(req))return reply(send,res,403,{error:'origin_not_allowed'});
 const actor=await authenticateTenant(req);
 if(!actor)return reply(send,res,401,{error:'valid_tenant_api_key_required'});
 if(req.method==='POST'&&!WRITE_ROLES.has(actor.role))return reply(send,res,403,{error:'tenant_role_insufficient',requiredRole:'integration'});
 const base=await dbPool();
 if(!base)return reply(send,res,503,{error:'ai_release_assurance_storage_unavailable'});
 const pool=tenantScopedPool(base,actor.tenant_id);
 if(!pool)return reply(send,res,503,{error:'ai_release_assurance_storage_unavailable'});

 if(req.method==='POST'){
  const input=await readBody(req);
  // This ingestion endpoint never treats caller-supplied approval or rollback claims as independently verified.
  // High/critical risk therefore remains HOLD until a separate authenticated reviewer workflow exists.
  const assessment=assessRelease({...input,tenantRef:actor.tenant_id,approval:null,rollback:null});
  const assessmentId=crypto.randomUUID();
  const values=[actor.tenant_id,assessmentId,assessment.release.releaseId,assessment.release.system,
   assessment.release.environment,assessment.release.riskTier,assessment.decision.status,
   assessment.proofFingerprint,JSON.stringify(assessment)];
  const inserted=await pool.query(
   'INSERT INTO public.keel_ai_release_assessments(tenant_id,assessment_id,release_ref,system_ref,environment_ref,risk_tier,decision_status,proof_fingerprint,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(tenant_id,proof_fingerprint) DO NOTHING RETURNING assessment_id,created_at',
   values);
  if(!inserted.rowCount){
   const existing=await pool.query('SELECT assessment_id,created_at,decision_status,proof_fingerprint FROM public.keel_ai_release_assessments WHERE tenant_id=$1 AND proof_fingerprint=$2',[actor.tenant_id,assessment.proofFingerprint]);
   if(!existing.rowCount)return reply(send,res,409,{error:'release_assessment_idempotency_conflict'});
   return reply(send,res,200,{ok:true,idempotent:true,...existing.rows[0],proofFingerprint:assessment.proofFingerprint});
  }
  return reply(send,res,201,{ok:true,assessmentId,decision:assessment.decision.status,
   findings:assessment.decision.findings,proofFingerprint:assessment.proofFingerprint,
   automaticDeploymentAuthorized:false,createdAt:inserted.rows[0].created_at});
 }
 const match=route.match(ITEM);
 if(match){
  const result=await pool.query('SELECT assessment_id,release_ref,system_ref,environment_ref,risk_tier,decision_status,proof_fingerprint,payload,created_at FROM public.keel_ai_release_assessments WHERE tenant_id=$1 AND assessment_id=$2',[actor.tenant_id,match[1]]);
  if(!result.rowCount)return reply(send,res,404,{error:'ai_release_assessment_not_found'});
  return reply(send,res,200,{ok:true,assessment:result.rows[0]});
 }
 const url=new URL(req.url,'http://localhost');
 const parsed=Number(url.searchParams.get('limit')||25);
 const limit=Number.isInteger(parsed)?Math.max(1,Math.min(parsed,100)):25;
 const result=await pool.query('SELECT assessment_id,release_ref,system_ref,environment_ref,risk_tier,decision_status,proof_fingerprint,created_at FROM public.keel_ai_release_assessments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2',[actor.tenant_id,limit]);
 return reply(send,res,200,{ok:true,assessments:result.rows,limit});
}
module.exports={handle,COLLECTION};
