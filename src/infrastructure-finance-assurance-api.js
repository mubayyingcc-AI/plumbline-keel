'use strict';
const engine=require('./infrastructure-finance-assurance');
const ROOT='/api/infrastructure';
function reply(send,res,status,payload){send(res,status,payload);return true;}
async function handle({req,res,route,authenticateTenant,tenantScopedPool,dbPool,send,readBody,sameOriginIfBrowser,crypto}){
 if(!route.startsWith(ROOT+'/')||route.startsWith(ROOT+'/sandbox/'))return false;
 const actor=await authenticateTenant(req);if(!actor)return reply(send,res,401,{error:'valid_tenant_api_key_required'});
 if(!actor.principal_id)return reply(send,res,403,{error:'named_principal_required'});
 const base=await dbPool();if(!base)return reply(send,res,503,{error:'infrastructure_storage_unavailable'});
 const pool=tenantScopedPool(base,actor.tenant_id);if(!pool)return reply(send,res,503,{error:'infrastructure_storage_unavailable'});
 if(req.method==='GET'&&route===ROOT+'/projects'){
  const q=await pool.query('SELECT project_id,display_name,currency,status,created_at,updated_at FROM public.keel_infrastructure_projects WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200',[actor.tenant_id]);
  return reply(send,res,200,{count:q.rowCount,projects:q.rows});
 }
 if(req.method==='POST'&&route===ROOT+'/projects'){
  if(!sameOriginIfBrowser(req))return reply(send,res,403,{error:'origin_not_allowed'});
  if(!['owner','admin'].includes(actor.role))return reply(send,res,403,{error:'tenant_admin_required'});
  const b=await readBody(req),projectId=String(b.projectId||'').trim(),name=String(b.name||'').trim(),currency=String(b.currency||'').toUpperCase();
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$/.test(projectId)||name.length<3||name.length>160||!/^[A-Z]{3}$/.test(currency))return reply(send,res,400,{error:'valid_project_id_name_and_iso_currency_required'});
  const q=await pool.query('INSERT INTO public.keel_infrastructure_projects(tenant_id,project_id,display_name,currency,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,project_id) DO NOTHING RETURNING project_id,display_name,currency,status,created_at',[actor.tenant_id,projectId,name,currency,actor.principal_id]);
  if(!q.rowCount)return reply(send,res,409,{error:'project_already_exists'});
  return reply(send,res,201,{ok:true,project:q.rows[0]});
 }
 if(req.method==='POST'&&route===ROOT+'/assessments'){
  if(!sameOriginIfBrowser(req))return reply(send,res,403,{error:'origin_not_allowed'});
  if(!['owner','admin','reviewer'].includes(actor.role))return reply(send,res,403,{error:'independent_finance_reviewer_or_admin_required'});
  const body=await readBody(req),input=body.assessment;
  const result=engine.assessInfrastructureProject(input);
  const project=await pool.query("SELECT project_id,currency,status FROM public.keel_infrastructure_projects WHERE tenant_id=$1 AND project_id=$2",[actor.tenant_id,result.projectId]);
  if(!project.rowCount)return reply(send,res,404,{error:'tenant_infrastructure_project_not_found'});
  if(project.rows[0].currency!==result.currency||project.rows[0].status!=='active')return reply(send,res,409,{error:'project_currency_or_status_mismatch'});
  const inputFingerprint=engine.digest(input),assessmentId=crypto.randomUUID();
  const q=await pool.query('INSERT INTO public.keel_infrastructure_assessments(tenant_id,assessment_id,project_id,schema_version,input_fingerprint,result_fingerprint,input_payload,result_payload,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) ON CONFLICT(tenant_id,project_id,input_fingerprint) DO NOTHING RETURNING assessment_id,created_at',[actor.tenant_id,assessmentId,result.projectId,result.schema,inputFingerprint,result.fingerprint,JSON.stringify(input),JSON.stringify(result),actor.principal_id]);
  if(!q.rowCount)return reply(send,res,409,{error:'identical_assessment_already_recorded'});
  return reply(send,res,201,{ok:true,assessmentId:q.rows[0].assessment_id,createdAt:q.rows[0].created_at,result});
 }
 if(req.method==='GET'&&route===ROOT+'/assessments'){
  const projectId=String(new URL(req.url,'http://keel.local').searchParams.get('projectId')||'').trim();
  if(!projectId)return reply(send,res,400,{error:'project_id_required'});
  const q=await pool.query('SELECT assessment_id,project_id,schema_version,input_fingerprint,result_fingerprint,result_payload,created_at FROM public.keel_infrastructure_assessments WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 100',[actor.tenant_id,projectId]);
  return reply(send,res,200,{count:q.rowCount,assessments:q.rows});
 }
 return reply(send,res,404,{error:'infrastructure_endpoint_not_found'});
}
module.exports={handle,ROOT};
