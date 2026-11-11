'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {handle,COLLECTION}=require('../src/ai-release-assurance-api');
const now='2026-11-11T00:00:00.000Z';
function input(overrides={}){return {releaseId:'release-api-1',tenantRef:'attacker-tenant',system:'enterprise-agent',environment:'staging',riskTier:'moderate',createdAt:now,changeRef:'change-1',
 components:[{componentId:'agent',kind:'agent',version:'1.0',fingerprint:'a'.repeat(64)}],
 requiredChecks:['safety','security'],checks:['safety','security'].map((category,i)=>({checkId:'check-'+i,category,outcome:'passed',evidenceRef:'artifact://'+category,evidenceFingerprint:String(i+1).repeat(64),executedAt:now})),...overrides};}
function context({method='POST',actor={tenant_id:'11111111-1111-4111-8111-111111111111',role:'integration',key_id:'key-1'},body=input(),queryResult={rowCount:1,rows:[{created_at:now}]}}={}){
 let response;
 const calls=[];
 return {calls,get response(){return response;},ctx:{req:{method,url:COLLECTION,headers:{}},res:{},route:COLLECTION,
  authenticateTenant:async()=>actor,tenantScopedPool:()=>({query:async(...args)=>{calls.push(args);return queryResult;}}),
  dbPool:async()=>({}),send:(_res,status,payload)=>{response={status,payload};return response;},
  readBody:async()=>body,sameOriginIfBrowser:()=>true,crypto}};
}
test('tenant release assessment persists with authenticated tenant, not caller tenant',async()=>{
 const c=context();assert.equal(await handle(c.ctx),c.response);
 assert.equal(c.response.status,201);
 assert.equal(c.response.payload.decision,'SAFE_TO_RELEASE');
 assert.equal(c.response.payload.automaticDeploymentAuthorized,false);
 const stored=JSON.parse(c.calls[0][1][8]);
 assert.equal(c.calls[0][1][0],'11111111-1111-4111-8111-111111111111');
 assert.equal(stored.release.tenantRef,'11111111-1111-4111-8111-111111111111');
});
test('API cannot accept caller-asserted high-risk approval as independent approval',async()=>{
 const body=input({riskTier:'critical',approval:{status:'approved',approverRef:'spoofed',approvedAt:now,scopeFingerprint:'b'.repeat(64)},rollback:{planRef:'fake',verified:true,testedAt:now}});
 const c=context({body});await handle(c.ctx);
 assert.equal(c.response.status,201);assert.equal(c.response.payload.decision,'HOLD');
 assert.ok(c.response.payload.findings.some(x=>x.code==='INDEPENDENT_APPROVAL_REQUIRED'));
 assert.ok(c.response.payload.findings.some(x=>x.code==='VERIFIED_ROLLBACK_REQUIRED'));
});
test('tenant API rejects missing authentication before database access',async()=>{
 const c=context({actor:null});await handle(c.ctx);
 assert.equal(c.response.status,401);assert.equal(c.calls.length,0);
});
test('tenant API restricts writes to owner, admin or integration role',async()=>{
 const c=context({actor:{tenant_id:'11111111-1111-4111-8111-111111111111',role:'analyst'}});
 await handle(c.ctx);assert.equal(c.response.status,403);assert.equal(c.calls.length,0);
});
test('tenant API list query is bounded and tenant-scoped',async()=>{
 const c=context({method:'GET',body:null,queryResult:{rowCount:0,rows:[]}});
 c.ctx.req.url=COLLECTION+'?limit=999';
 await handle(c.ctx);
 assert.equal(c.response.status,200);
 assert.equal(c.calls[0][1][0],'11111111-1111-4111-8111-111111111111');
 assert.equal(c.calls[0][1][1],100);
});
