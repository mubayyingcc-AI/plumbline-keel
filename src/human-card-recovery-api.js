'use strict';
const policy=require('./human-card-recovery');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function handle({req,res,route,authenticateTenant,dbPool,send,readBody,sameOriginIfBrowser,recordEventWithClient,crypto,cleanString}){
 const groups=route==='/api/human-card/recovery/groups'&&req.method==='POST';
 const requests=route==='/api/human-card/recovery/requests'&&req.method==='POST';
 const approval=route.match(/^\/api\/human-card\/recovery\/requests\/([0-9a-f-]{36})\/approvals$/i)&&req.method==='POST';
 const finalise=route.match(/^\/api\/human-card\/recovery\/requests\/([0-9a-f-]{36})\/finalise$/i)&&req.method==='POST';
 if(!groups&&!requests&&!approval&&!finalise)return false;
 if(!sameOriginIfBrowser(req)){send(res,403,{error:'origin_not_allowed'});return true;}
 const actor=await authenticateTenant(req);
 if(!actor){send(res,401,{error:'valid_tenant_api_key_required'});return true;}
 if(!actor.principal_id){send(res,403,{error:'named_principal_required'});return true;}
 const pool=await dbPool();
 if(!pool){send(res,503,{error:'card_registry_unavailable'});return true;}
 if(groups){
  const body=await readBody(req),ids=Array.isArray(body.trusteePrincipalIds)?body.trusteePrincipalIds.map(x=>cleanString(x,80)):[];
  if(ids.some(id=>!UUID.test(id))){send(res,400,{error:'trustee_principal_ids_must_be_uuids'});return true;}
  const verified=ids.length?await pool.query("SELECT principal_id::text FROM keel_principals WHERE tenant_id=$1 AND status='active' AND identity_assurance='externally_verified' AND principal_id=ANY($2::uuid[])",[actor.tenant_id,ids]):{rows:[]};
  let group;
  try{group=policy.validateRecoveryGroup({ownerPrincipalId:actor.principal_id,trusteePrincipalIds:ids,threshold:Number(body.threshold),delayHours:Number(body.delayHours),verifiedTrustees:verified.rows.map(x=>x.principal_id)});}
  catch(error){send(res,400,{error:error.message});return true;}
  const groupId=crypto.randomUUID(),client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query("INSERT INTO keel_human_card_recovery_groups(tenant_id,recovery_group_id,owner_principal_id,threshold,delay_hours,status) VALUES($1,$2,$3,$4,$5,'active')",[actor.tenant_id,groupId,actor.principal_id,group.threshold,group.delayHours]);
   for(const id of group.trusteePrincipalIds)await client.query('INSERT INTO keel_human_card_recovery_trustees(tenant_id,recovery_group_id,trustee_principal_id) VALUES($1,$2,$3)',[actor.tenant_id,groupId,id]);
   await recordEventWithClient(client,actor,'HUMAN_CARD_RECOVERY_GROUP_CREATED',groupId,{threshold:group.threshold,delayHours:group.delayHours,trusteeCount:group.trusteePrincipalIds.length});
   await client.query('COMMIT');
   send(res,201,{ok:true,recoveryGroup:{recoveryGroupId:groupId,threshold:group.threshold,delayHours:group.delayHours,trusteeCount:group.trusteePrincipalIds.length}});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  return true;
 }
 if(requests){
  const body=await readBody(req),cardId=cleanString(body.cardId,100),reason=cleanString(body.reasonCode,40);
  if(!cardId||!['card_lost','card_stolen','device_compromised','recovery_test','replacement'].includes(reason)){send(res,400,{error:'valid_card_id_and_recovery_reason_required'});return true;}
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const d=await client.query('SELECT * FROM keel_human_card_devices WHERE tenant_id=$1 AND card_id=$2 AND principal_id=$3 FOR UPDATE',[actor.tenant_id,cardId,actor.principal_id]);
   if(!d.rowCount){await client.query('ROLLBACK');send(res,404,{error:'human_card_not_found'});return true;}
   if(['lost','revoked','replaced'].includes(d.rows[0].device_status)){await client.query('ROLLBACK');send(res,409,{error:'card_already_lost_or_revoked'});return true;}
   const g=await client.query("SELECT * FROM keel_human_card_recovery_groups WHERE tenant_id=$1 AND owner_principal_id=$2 AND status='active' ORDER BY created_at DESC LIMIT 1 FOR UPDATE",[actor.tenant_id,actor.principal_id]);
   if(!g.rowCount){await client.query('ROLLBACK');send(res,409,{error:'active_independent_recovery_group_required'});return true;}
   const r=crypto.randomUUID(),group=g.rows[0];
   await client.query("UPDATE keel_human_card_devices SET device_status='lost',lifecycle_state='locked',updated_at=NOW() WHERE tenant_id=$1 AND card_id=$2",[actor.tenant_id,cardId]);
   await client.query("INSERT INTO keel_human_card_recovery_requests(tenant_id,recovery_request_id,card_id,owner_principal_id,recovery_group_id,reason_code,status,threshold_snapshot,delay_hours_snapshot) VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8)",[actor.tenant_id,r,cardId,actor.principal_id,group.recovery_group_id,reason,group.threshold,group.delay_hours]);
   await recordEventWithClient(client,actor,'HUMAN_CARD_LOST_LOCKED_RECOVERY_OPENED',cardId,{requestId:r,reasonCode:reason,recoveryGroupId:group.recovery_group_id});
   await client.query('COMMIT');
   send(res,201,{ok:true,recoveryRequest:{requestId:r,status:'pending',cardStatus:'lost',virtualChannel:'LOCKED',threshold:group.threshold,delayHours:group.delay_hours}});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  return true;
 }
 if(approval){
  const body=await readBody(req),decision=cleanString(body.decision,12),rationale=cleanString(body.rationaleCode,80);
  if(!['approve','reject'].includes(decision)||!rationale){send(res,400,{error:'decision_and_rationale_code_required'});return true;}
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const q=await client.query("SELECT r.* FROM keel_human_card_recovery_requests r WHERE r.tenant_id=$1 AND r.recovery_request_id=$2 AND EXISTS(SELECT 1 FROM keel_human_card_recovery_trustees t WHERE t.tenant_id=r.tenant_id AND t.recovery_group_id=r.recovery_group_id AND t.trustee_principal_id=$3) FOR UPDATE",[actor.tenant_id,approval[1],actor.principal_id]);
   if(!q.rowCount){await client.query('ROLLBACK');send(res,403,{error:'independent_recovery_trustee_required'});return true;}
   const r=q.rows[0],prior=await client.query('SELECT 1 FROM keel_human_card_recovery_approvals WHERE tenant_id=$1 AND recovery_request_id=$2 AND trustee_principal_id=$3',[actor.tenant_id,r.recovery_request_id,actor.principal_id]);
   const check=policy.evaluateRecoveryApproval({status:r.status,ownerPrincipalId:r.owner_principal_id,trusteePrincipalId:actor.principal_id,decision,alreadyApproved:prior.rowCount>0,threshold:r.threshold_snapshot,delayHours:r.delay_hours_snapshot});
   if(!check.accepted){await client.query('ROLLBACK');send(res,409,{error:check.reason});return true;}
   await client.query('INSERT INTO keel_human_card_recovery_approvals(tenant_id,recovery_request_id,trustee_principal_id,decision,rationale_code) VALUES($1,$2,$3,$4,$5)',[actor.tenant_id,r.recovery_request_id,actor.principal_id,decision,rationale]);
   let status='pending',eligibleAt=null;
   if(decision==='reject')status='rejected';
   else{
    const count=await client.query("SELECT COUNT(*)::int AS n FROM keel_human_card_recovery_approvals WHERE tenant_id=$1 AND recovery_request_id=$2 AND decision='approve'",[actor.tenant_id,r.recovery_request_id]);
    if(count.rows[0].n>=r.threshold_snapshot){
     status='approved_waiting_period';
     const u=await client.query("UPDATE keel_human_card_recovery_requests SET status=$3,eligible_at=NOW()+($4::text||' hours')::interval WHERE tenant_id=$1 AND recovery_request_id=$2 RETURNING eligible_at",[actor.tenant_id,r.recovery_request_id,status,r.delay_hours_snapshot]);
     eligibleAt=u.rows[0].eligible_at;
    }
   }
   if(status==='rejected')await client.query("UPDATE keel_human_card_recovery_requests SET status='rejected' WHERE tenant_id=$1 AND recovery_request_id=$2",[actor.tenant_id,r.recovery_request_id]);
   await recordEventWithClient(client,actor,'HUMAN_CARD_RECOVERY_TRUSTEE_DECISION',r.recovery_request_id,{decision,status,rationaleCode:rationale,eligibleAt:eligibleAt?new Date(eligibleAt).toISOString():null});
   await client.query('COMMIT');
   send(res,200,{ok:true,recoveryRequest:{requestId:r.recovery_request_id,status,eligibleAt:eligibleAt?new Date(eligibleAt).toISOString():null}});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  return true;
 }
 if(finalise){
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const q=await client.query('SELECT * FROM keel_human_card_recovery_requests WHERE tenant_id=$1 AND recovery_request_id=$2 AND owner_principal_id=$3 FOR UPDATE',[actor.tenant_id,finalise[1],actor.principal_id]);
   if(!q.rowCount){await client.query('ROLLBACK');send(res,404,{error:'recovery_request_not_found'});return true;}
   const r=q.rows[0],eligibleAt=r.eligible_at instanceof Date?r.eligible_at.toISOString():r.eligible_at;
   const result=policy.finaliseRecovery({status:r.status,eligibleAt});
   if(!result.accepted){await client.query('ROLLBACK');send(res,409,{error:result.reason});return true;}
   await client.query("UPDATE keel_human_card_recovery_requests SET status='replacement_pending',completed_at=NOW() WHERE tenant_id=$1 AND recovery_request_id=$2",[actor.tenant_id,r.recovery_request_id]);
   await recordEventWithClient(client,actor,'HUMAN_CARD_RECOVERY_REPLACEMENT_PENDING',r.card_id,{requestId:r.recovery_request_id,oldCardStatus:'lost',replacementRequiresPartnerProvisioning:true,virtualChannel:'locked'});
   await client.query('COMMIT');
   send(res,200,{ok:true,recoveryRequest:{requestId:r.recovery_request_id,status:'replacement_pending',oldCard:'lost',replacement:'partner_provisioning_required',virtualChannel:'LOCKED'}});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  return true;
 }
 return false;
}
module.exports={handle};
