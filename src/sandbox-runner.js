'use strict';
const crypto=require('node:crypto');
const {fingerprint}=require('./core');

const SCENARIOS=new Set(['KFS-001','KFS-002']);
function fixture(scenarioId,now){
 const stale=scenarioId==='KFS-002';
 return {
  synthetic:true,
  state:{currency:'USD',assets:[{id:'ASSET-SYN-SANDBOX-001',grossValue:10000000,encumberedValue:2000000,evidence:[{id:'EVID-SYN-SANDBOX-001',source:'Keel public synthetic sandbox fixture',observedAt:new Date(now.getTime()-(stale?8*86400000:0)).toISOString(),class:'simulated',encumbranceStatus:'known'}]}]},
  policy:{id:'KFS-PUBLIC-001',version:'1.0.0',haircutRate:.1,maxEvidenceAgeMs:86400000},
  action:{id:'KFS-'+scenarioId+'-'+crypto.randomUUID(),type:'financing_request',amount:7000000,authorized:true}
 };
}
function runPublicScenario(scenarioId,evaluate=evaluateDefault,now=new Date()){
 if(!SCENARIOS.has(scenarioId))throw new Error('unsupported_public_sandbox_scenario');
 if(typeof evaluate!=='function')throw new Error('financial_engine_required');
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new Error('valid_sandbox_clock_required');
 const startedAt=now.toISOString(),input=fixture(scenarioId,now),result=evaluate(input,now);
 const stale=scenarioId==='KFS-002';
 const assertions=[
  {id:'decision_expected',required:true,passed:stale?result.decision==='HOLD':result.decision==='ALLOW',expected:stale?'HOLD':'ALLOW',actual:result.decision},
  {id:'capacity_expected',required:true,passed:stale?result.capacity.totals.capacity===null:result.capacity.totals.capacity===7200000,expected:stale?'null (stale evidence)':'7200000',actual:result.capacity.totals.capacity},
  {id:'evidence_issue_expected',required:true,passed:stale?result.capacity.issues.some(x=>x.code==='STALE_EVIDENCE'):result.capacity.issues.length===0,expected:stale?'STALE_EVIDENCE':'no issues',actual:result.capacity.issues.map(x=>x.code)}
 ];
 const status=assertions.every(x=>x.passed)?'PASSED':'FAILED';
 const unsigned={
  schemaVersion:'keel-financial-test-record-0.1',
  runId:crypto.randomUUID(),
  environmentClass:'PUBLIC_TEST_LAB',
  dataClass:'synthetic',
  scenario:{id:scenarioId,version:'1.0.0'},
  engine:{name:'Keel collateral evaluator',schemaVersion:result.schemaVersion},
  manifest:{inputFingerprint:fingerprint(input),policyId:input.policy.id,policyVersion:input.policy.version},
  assertions,
  actual:{decision:result.decision,capacity:result.capacity.totals.capacity,evidenceIssues:result.capacity.issues},
  decisionRecordFingerprint:result.recordFingerprint,
  status,
  startedAt,
  completedAt:now.toISOString(),
  evidenceBoundary:'Supplied synthetic fixture evaluated by the current collateral evaluator only; no external institution or financial system was queried.',
  signature:{status:'NOT_SIGNED',reason:'Public alpha KFTR is fingerprinted only; managed signing keys and independent verification are not implemented.'},
  persistence:{status:'NOT_PERSISTED',reason:'Public alpha runs are stateless and are not retained as an institutional audit record.'}
 };
 return {...unsigned,recordFingerprint:fingerprint(unsigned)};
}
function evaluateDefault(input,now){return require('./core').evaluateAction(input,now);}
module.exports={SCENARIOS,fixture,runPublicScenario};
