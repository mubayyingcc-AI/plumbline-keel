'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const runtimeUrl=process.env.KEEL_LEDGER_TEST_DATABASE_URL;
const adminUrl=process.env.PG_ADMIN_URL;

test('AI release assessment store enforces tenant RLS, append-only evidence and least privilege',
 {skip:!runtimeUrl||!adminUrl?'Requires the migrated disposable PostgreSQL CI database':false},async()=>{
 const {Pool}=require('pg'),runtime=new Pool({connectionString:runtimeUrl,max:2}),admin=new Pool({connectionString:adminUrl,max:2});
 const tenantA=crypto.randomUUID(),tenantB=crypto.randomUUID(),assessmentId=crypto.randomUUID(),suffix=crypto.randomUUID().replace(/-/g,'').slice(0,12);
 async function scoped(pool,tenant,sql,values=[]){
  const client=await pool.connect();try{await client.query('BEGIN');await client.query("SELECT set_config('keel.tenant_id',$1,true)",[tenant]);const r=await client.query(sql,values);await client.query('COMMIT');return r;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 try{
  await admin.query('INSERT INTO keel_tenants(tenant_id,tenant_name,tenant_slug,status) VALUES($1,$2,$3,\'active\'),($4,$5,$6,\'active\')',[tenantA,'AI release tenant A '+suffix,'ai-release-a-'+suffix,tenantB,'AI release tenant B '+suffix,'ai-release-b-'+suffix]);
  const payload={schemaVersion:'keel-ai-release-assessment/v1',release:{releaseId:'release-'+suffix},decision:{status:'HOLD'},proofFingerprint:'a'.repeat(64)};
  await scoped(runtime,tenantA,'INSERT INTO public.keel_ai_release_assessments(tenant_id,assessment_id,release_ref,system_ref,environment_ref,risk_tier,decision_status,proof_fingerprint,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[tenantA,assessmentId,'release-'+suffix,'agent-system','staging','moderate','HOLD','a'.repeat(64),JSON.stringify(payload)]);
  const a=await scoped(runtime,tenantA,'SELECT assessment_id FROM public.keel_ai_release_assessments WHERE assessment_id=$1',[assessmentId]);
  const b=await scoped(runtime,tenantB,'SELECT assessment_id FROM public.keel_ai_release_assessments WHERE assessment_id=$1',[assessmentId]);
  const noContext=await runtime.query('SELECT assessment_id FROM public.keel_ai_release_assessments WHERE assessment_id=$1',[assessmentId]);
  assert.equal(a.rowCount,1);assert.equal(b.rowCount,0);assert.equal(noContext.rowCount,0);
  await assert.rejects(()=>scoped(runtime,tenantA,'UPDATE public.keel_ai_release_assessments SET decision_status=\'SAFE_TO_RELEASE\' WHERE assessment_id=$1',[assessmentId]),/keel_ai_release_assessment_is_immutable/);
  await assert.rejects(()=>scoped(runtime,tenantA,'DELETE FROM public.keel_ai_release_assessments WHERE assessment_id=$1',[assessmentId]),/keel_ai_release_assessment_is_immutable/);
  const privilege=await runtime.query("SELECT has_table_privilege(current_user,'public.keel_ai_release_assessments','SELECT') AS can_select,has_table_privilege(current_user,'public.keel_ai_release_assessments','INSERT') AS can_insert,has_table_privilege(current_user,'public.keel_ai_release_assessments','UPDATE') AS can_update,has_table_privilege(current_user,'public.keel_ai_release_assessments','DELETE') AS can_delete");
  assert.equal(privilege.rows[0].can_select,true);assert.equal(privilege.rows[0].can_insert,true);assert.equal(privilege.rows[0].can_update,false);assert.equal(privilege.rows[0].can_delete,false);
 }finally{await runtime.end();await admin.end();}
});
