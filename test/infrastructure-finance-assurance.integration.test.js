'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const runtimeUrl=process.env.KEEL_LEDGER_TEST_DATABASE_URL,adminUrl=process.env.PG_ADMIN_URL;
if(runtimeUrl)process.env.KEEL_RUNTIME_DATABASE_URL=runtimeUrl;
const {server,dbPool}=require('../server');
const {Pool}=require('pg');
const {issueTenantKey}=require('../src/tenant-security');
test('infrastructure finance project and immutable assessment history persist under tenant RLS',{skip:!runtimeUrl||!adminUrl?'Requires migrated disposable PostgreSQL CI database':false},async()=>{
 const admin=new Pool({connectionString:adminUrl,max:2}),tenantId=crypto.randomUUID(),suffix=crypto.randomUUID().replace(/-/g,'').slice(0,12);
 let runtime,started=false;
 const principalId=crypto.randomUUID(),key=issueTenantKey();
 try{
  runtime=await dbPool();
  await admin.query("INSERT INTO keel_tenants(tenant_id,tenant_name,tenant_slug,status) VALUES($1,$2,$3,'active')",[tenantId,'Infrastructure Test '+suffix,'ifa-test-'+suffix]);
  await admin.query("INSERT INTO keel_principals(principal_id,tenant_id,display_name,email,identity_assurance,principal_kind) VALUES($1,$2,'Infrastructure Reviewer',$3,'externally_verified','human')",[principalId,tenantId,'ifa-'+suffix+'@example.test']);
  await admin.query("INSERT INTO keel_tenant_keys(key_id,tenant_id,token_hash,label,role,principal_id) VALUES($1,$2,$3,'IFA owner','owner',$4)",[key.keyId,tenantId,key.tokenHash,principalId]);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));started=true;
  const base='http://127.0.0.1:'+server.address().port;
  const request=async(path,method,body)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+key.token,'Origin':base},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  const project=await request('/api/infrastructure/projects','POST',{projectId:'gpu-project-'+suffix,name:'GPU Project '+suffix,currency:'USD'});
  assert.equal(project.status,201,JSON.stringify(project.data));
  const assessment={projectId:'gpu-project-'+suffix,name:'GPU Project '+suffix,currency:'USD',assetValueMinor:'100000000000',encumberedValueMinor:'10000000000',haircutBps:2000,annualContractedRevenueMinor:'42000000000',annualCollectedRevenueMinor:'36000000000',annualOperatingCostsMinor:'14000000000',annualDebtServiceMinor:'18000000000',deployedCapacityUnits:1000,availableCapacityUnits:180,evidence:{assetRegister:'verified',ownership:'verified',encumbranceSearch:'verified',customerContracts:'verified',billing:'observed',cashCollections:'observed',operatingCosts:'verified',debtSchedule:'verified',capacityTelemetry:'observed'}};
  const saved=await request('/api/infrastructure/assessments','POST',{assessment});
  assert.equal(saved.status,201,JSON.stringify(saved.data));assert.equal(saved.data.result.creditDecision,false);
  assert.equal(saved.data.result.asset.eligibleValueAfterEncumbranceMinor,'70000000000');
  const history=await request('/api/infrastructure/assessments?projectId=gpu-project-'+suffix,'GET');
  assert.equal(history.status,200);assert.equal(history.data.count,1);assert.equal(history.data.assessments[0].result_fingerprint,saved.data.result.fingerprint);
  const replay=await request('/api/infrastructure/assessments','POST',{assessment});
  assert.equal(replay.status,409,'identical assessment must not create a duplicate immutable record');
 }finally{
  if(started)await new Promise(resolve=>server.close(resolve));
  if(runtime)await runtime.end();
  await admin.end();
 }
});
