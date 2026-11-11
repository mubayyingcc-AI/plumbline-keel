'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {KeelAIReleaseClient,KeelApiError}=require('../src/ai-release-assurance-client');
const key='kk_live_'+ 'a'.repeat(43);
test('client posts release assessment with tenant API bearer credential',async()=>{
 let call;
 const client=new KeelAIReleaseClient({baseUrl:'https://keel.example',apiKey:key,fetchImpl:async(url,options)=>{call={url,options};return {ok:true,status:201,json:async()=>({ok:true,decision:'HOLD'})};}});
 const body={releaseId:'rel-1',riskTier:'moderate'};
 const result=await client.createAssessment(body);
 assert.equal(result.decision,'HOLD');assert.equal(call.url,'https://keel.example/api/ai/release-assessments');
 assert.equal(call.options.method,'POST');assert.equal(call.options.headers.Authorization,'Bearer '+key);
 assert.deepEqual(JSON.parse(call.options.body),body);
});
test('client lists assessments with bounded page size',async()=>{
 let called;
 const client=new KeelAIReleaseClient({baseUrl:'https://keel.example',apiKey:key,fetchImpl:async(url)=>{called=url;return {ok:true,status:200,json:async()=>({assessments:[]})};}});
 await client.listAssessments({limit:100});assert.equal(called,'https://keel.example/api/ai/release-assessments?limit=100');
 assert.throws(()=>client.listAssessments({limit:101}),/keel_list_limit_must_be_1_to_100/);
});
test('client retrieves a single UUID assessment',async()=>{
 let called;
 const id='11111111-1111-4111-8111-111111111111';
 const client=new KeelAIReleaseClient({baseUrl:'https://keel.example',apiKey:key,fetchImpl:async(url)=>{called=url;return {ok:true,status:200,json:async()=>({assessmentId:id})};}});
 await client.getAssessment(id);assert.equal(called,'https://keel.example/api/ai/release-assessments/'+id);
 assert.throws(()=>client.getAssessment('not-a-uuid'),/keel_assessment_id_invalid/);
});
test('client refuses non-HTTPS remote endpoints and malformed keys',()=>{
 assert.throws(()=>new KeelAIReleaseClient({baseUrl:'http://api.example',apiKey:key}),/keel_https_required/);
 assert.throws(()=>new KeelAIReleaseClient({baseUrl:'https://api.example',apiKey:'bad'}),/keel_api_key_invalid/);
});
test('client returns structured API failures without exposing the API key',async()=>{
 const client=new KeelAIReleaseClient({baseUrl:'https://keel.example',apiKey:key,fetchImpl:async()=>({ok:false,status:403,json:async()=>({error:'tenant_role_insufficient'})})});
 await assert.rejects(()=>client.listAssessments(),e=>e instanceof KeelApiError&&e.status===403&&e.code==='tenant_role_insufficient'&&!String(e).includes(key));
});
test('local development may use localhost HTTP',()=>{
 const client=new KeelAIReleaseClient({baseUrl:'http://localhost:3000',apiKey:key,fetchImpl:async()=>({ok:true,status:200,json:async()=>({ok:true})})});
 assert.ok(client);
});
