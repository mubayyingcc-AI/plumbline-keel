'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessRelease,verifyReleaseAssessment}=require('../src/ai-release-assurance');
const {fingerprint}=require('../src/core');
const now='2026-11-11T00:00:00.000Z';
function fixture(overrides={}) {
 const components=[{componentId:'assistant-model',kind:'model',version:'v4',fingerprint:'a'.repeat(64),changeRef:'model-v4'}];
 const checks=['safety','security','quality','regression'].map((category,i)=>({
  checkId:'check-'+i,category,outcome:'passed',evidenceRef:'artifact://'+category,
  evidenceFingerprint:String(i+1).repeat(64),executedAt:now
 }));
 return {releaseId:'rel-001',tenantRef:'tenant-ref-001',system:'customer-assistant',environment:'staging',
  riskTier:'moderate',createdAt:now,changeRef:'change-001',components,
  requiredChecks:['safety','security','quality','regression'],checks,...overrides};
}
test('domain-neutral AI release with complete required evidence is safe to release',()=>{
 const result=assessRelease(fixture(),new Date(now));
 assert.equal(result.decision.status,'SAFE_TO_RELEASE');
 assert.equal(result.decision.automaticDeploymentAuthorized,false);
 assert.equal(verifyReleaseAssessment(result).valid,true);
});
test('missing required check is held',()=>{
 const p=fixture();p.checks=p.checks.filter(x=>x.category!=='security');
 const r=assessRelease(p,new Date(now));
 assert.equal(r.decision.status,'HOLD');
 assert.ok(r.decision.findings.some(x=>x.code==='REQUIRED_CHECK_MISSING'&&x.category==='security'));
});
test('failed and not-run checks cannot pass',()=>{
 const p=fixture();p.checks[0].outcome='failed';p.checks[1].outcome='not_run';
 const r=assessRelease(p,new Date(now));
 assert.equal(r.decision.status,'HOLD');
 assert.equal(r.decision.findings.filter(x=>x.code==='REQUIRED_CHECK_NOT_PASSED').length,2);
});
test('a passed check without immutable evidence reference is held',()=>{
 const p=fixture();p.checks[0].evidenceFingerprint=null;
 const r=assessRelease(p,new Date(now));
 assert.ok(r.decision.findings.some(x=>x.code==='CHECK_EVIDENCE_INCOMPLETE'));
});
test('high-risk release requires independent scoped approval and tested rollback',()=>{
 const p=fixture({riskTier:'high'});
 const r=assessRelease(p,new Date(now));
 assert.ok(r.decision.findings.some(x=>x.code==='INDEPENDENT_APPROVAL_REQUIRED'));
 assert.ok(r.decision.findings.some(x=>x.code==='VERIFIED_ROLLBACK_REQUIRED'));
});
test('high-risk approval must bind the exact release and component set',()=>{
 const p=fixture({riskTier:'critical'});
 p.approval={status:'approved',approverRef:'principal-2',approvedAt:now,scopeFingerprint:'b'.repeat(64)};
 p.rollback={planRef:'rollback://release-001',verified:true,testedAt:now};
 const r=assessRelease(p,new Date(now));
 assert.ok(r.decision.findings.some(x=>x.code==='APPROVAL_SCOPE_MISMATCH'));
});
test('correctly scoped approval and tested rollback allow high-risk assessment',()=>{
 const p=fixture({riskTier:'high'});
 p.approval={status:'approved',approverRef:'independent-reviewer',approvedAt:now,
  scopeFingerprint:fingerprint({releaseId:p.releaseId,changeRef:p.changeRef,components:p.components.map(x=>({...x,kind:x.kind,version:x.version,fingerprint:x.fingerprint,changeRef:x.changeRef}))})};
 p.rollback={planRef:'rollback://release-001',verified:true,testedAt:now};
 assert.equal(assessRelease(p,new Date(now)).decision.status,'SAFE_TO_RELEASE');
});
test('proof fingerprint detects tampering',()=>{
 const r=assessRelease(fixture(),new Date(now));
 const changed={...r,release:{...r.release,environment:'production'}};
 assert.equal(verifyReleaseAssessment(changed).valid,false);
});
test('duplicate components and unknown component types are rejected',()=>{
 const p=fixture();p.components.push({...p.components[0]});
 assert.throws(()=>assessRelease(p,new Date(now)),/duplicate_component_id/);
 const q=fixture();q.components[0].kind='magic';
 assert.throws(()=>assessRelease(q,new Date(now)),/unsupported_component_kind/);
});
test('AI release evidence cannot claim automatic deployment authorization',()=>{
 const r=assessRelease(fixture(),new Date(now));
 assert.equal(r.decision.automaticDeploymentAuthorized,false);
 assert.ok(r.limitations.some(x=>x.includes('does not independently execute tests')));
});
