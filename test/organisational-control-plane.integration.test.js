'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const runtimeUrl=process.env.KEEL_LEDGER_TEST_DATABASE_URL,adminUrl=process.env.PG_ADMIN_URL;
if(runtimeUrl)process.env.KEEL_RUNTIME_DATABASE_URL=runtimeUrl;
const {server,dbPool}=require('../server');
const {Pool}=require('pg');
const {issueTenantKey}=require('../src/tenant-security');
const baseTenant='keel-control-integration-';
test('organisational control plane persists, authorizes, holds, approves and enforces amount/resource scope against PostgreSQL',{skip:!runtimeUrl||!adminUrl?'Requires migrated disposable PostgreSQL CI database':false},async()=>{
 const admin=new Pool({connectionString:adminUrl,max:2}),tenantId=crypto.randomUUID(),suffix=crypto.randomUUID().replace(/-/g,'').slice(0,12);
 let runtime,started=false;
 const ownerId=crypto.randomUUID(),agentId=crypto.randomUUID(),approverId=crypto.randomUUID();
 const ownerKey=issueTenantKey(),agentKey=issueTenantKey(),approverKey=issueTenantKey();
 const now=Date.now(),expiresAt=new Date(now+3600000).toISOString();
 try{
  runtime=await dbPool();
  await admin.query("INSERT INTO keel_tenants(tenant_id,tenant_name,tenant_slug,status) VALUES($1,$2,$3,'active')",[tenantId,baseTenant+suffix,'keel-control-'+suffix]);
  await admin.query("INSERT INTO keel_principals(principal_id,tenant_id,display_name,email,identity_assurance,principal_kind) VALUES($1,$4,'Control Owner',$5,'externally_verified','human'),($2,$4,'CRM Agent',$6,'self_asserted','ai_agent'),($3,$4,'Independent Approver',$7,'externally_verified','human')",[ownerId,agentId,approverId,tenantId,'owner-'+suffix+'@example.test','agent-'+suffix+'@example.test','approver-'+suffix+'@example.test']);
  await admin.query("INSERT INTO keel_tenant_keys(key_id,tenant_id,token_hash,label,role,principal_id) VALUES($1,$4,$5,'Owner','owner',$7),($2,$4,$6,'Agent','integration',$8),($3,$4,$9,'Approver','reviewer',$10)",[ownerKey.keyId,agentKey.keyId,approverKey.keyId,tenantId,ownerKey.tokenHash,agentKey.tokenHash,ownerId,agentId,approverKey.tokenHash,approverId]);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));started=true;
  const base='http://127.0.0.1:'+server.address().port;
  const post=async(path,token,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'Origin':base},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  const manifest={integrationId:'crm-agent-'+suffix,providerId:'crm',displayName:'CRM Agent',version:'1.0.0',principalId:agentId,capabilities:[
   {operation:'customer.read_profile',type:'read',resourceTypes:['customer_profile'],riskTier:'low',sideEffects:false},
   {operation:'payment.release',type:'execute',resourceTypes:['payment'],riskTier:'critical',sideEffects:true}
  ]};
  const registered=await post('/api/control/integrations',ownerKey.token,manifest);
  assert.equal(registered.status,201,JSON.stringify(registered.data));
  const integrationResource='integration:'+manifest.integrationId,customerResource='customer:'+suffix,paymentResource='payment:'+suffix;
  const readEnvelope=await post('/api/assurance/authority/envelopes',ownerKey.token,{granteePrincipalId:agentId,scopes:['integration:tool:invoke'],resourceIds:[integrationResource,customerResource],expiresAt});
  assert.equal(readEnvelope.status,201,JSON.stringify(readEnvelope.data));
  const readAction={integrationId:manifest.integrationId,operation:'customer.read_profile',resourceId:customerResource,resourceType:'customer_profile',payload:{purpose:'support_case_'+suffix},envelopeId:readEnvelope.data.envelope.envelopeId};
  const permitted=await post('/api/control/actions/evaluate',agentKey.token,readAction);
  assert.equal(permitted.status,200,JSON.stringify(permitted.data));assert.equal(permitted.data.decision,'PERMIT');assert.equal(permitted.data.execution,'NOT_EXECUTED');assert.ok(permitted.data.proof.proofId);
  const highEnvelope=await post('/api/assurance/authority/envelopes',ownerKey.token,{granteePrincipalId:agentId,scopes:['integration:tool:invoke'],resourceIds:[integrationResource,paymentResource],currency:'USD',maxAmountMinor:'1000',approvalRequired:true,approverPrincipalId:approverId,expiresAt});
  assert.equal(highEnvelope.status,201,JSON.stringify(highEnvelope.data));
  const highAction={integrationId:manifest.integrationId,operation:'payment.release',resourceId:paymentResource,resourceType:'payment',payload:{paymentRef:'opaque-'+suffix},amountMinor:'900',currency:'USD',envelopeId:highEnvelope.data.envelope.envelopeId};
  const held=await post('/api/control/actions/evaluate',agentKey.token,highAction);
  assert.equal(held.status,202,JSON.stringify(held.data));assert.equal(held.data.decision,'REQUIRE_APPROVAL');assert.equal(held.data.execution,'NOT_EXECUTED');
  const approved=await post('/api/assurance/authority/approvals',approverKey.token,{envelopeId:highEnvelope.data.envelope.envelopeId,requestFingerprint:held.data.requestFingerprint,decision:'approve',rationale:'Independent approval for exact request fingerprint'});
  assert.equal(approved.status,201,JSON.stringify(approved.data));
  const afterApproval=await post('/api/control/actions/evaluate',agentKey.token,highAction);
  assert.equal(afterApproval.status,200,JSON.stringify(afterApproval.data));assert.equal(afterApproval.data.decision,'PERMIT');
  const replay=await post('/api/control/actions/evaluate',agentKey.token,highAction);
  assert.equal(replay.status,409,'authorized action request cannot be replayed as a fresh authorization');
  const overLimit=await post('/api/control/actions/evaluate',agentKey.token,{...highAction,payload:{paymentRef:'over-limit-'+suffix},amountMinor:'1001'});
  assert.equal(overLimit.status,403,JSON.stringify(overLimit.data));assert.equal(overLimit.data.decision,'DENY');
  const altered=await post('/api/control/actions/evaluate',agentKey.token,{...highAction,payload:{paymentRef:'altered-'+suffix}});
  assert.equal(altered.status,202,'changed payload must not inherit the prior approval');
  const list=await fetch(base+'/api/control/actions',{headers:{'Authorization':'Bearer '+ownerKey.token}});
  const history=await list.json();assert.equal(list.status,200);assert.ok(history.actions.length>=4);
  const proofCount=await admin.query('SELECT count(*)::int AS count FROM keel_action_proof_objects WHERE tenant_id=$1',[tenantId]);
  assert.ok(proofCount.rows[0].count>=2);
 }finally{
  if(started)await new Promise(resolve=>server.close(resolve));
  if(runtime)await runtime.end();
  await admin.end();
 }
});
