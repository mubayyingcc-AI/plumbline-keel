'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildOriginMark,buildModelCensus,buildProofDocket,buildFallbackMandate,assessDrift}=require('../src/assurance');
const now='2026-10-30T12:00:00.000Z';
function payload(){return {
 state:{currency:'USD',assets:[{id:'A-1',grossValue:10000000,encumberedValue:2000000,evidence:[{id:'E-1',source:'custodian-fixture',observedAt:now,class:'observed',encumbranceStatus:'known'}]}]},
 policy:{id:'POL-1',version:'1.2.0',haircutRate:.1,maxEvidenceAgeMs:86400000,thresholds:{reviewAbove:5000000}},
 action:{id:'ACT-1',type:'capacity_review',amount:7000000,authorized:true},
 sources:[{sourceId:'SRC-1',sourceType:'custodian_record',sourceName:'Synthetic custodian fixture',observedAt:now,ingestionMethod:'api',evidenceClass:'observed',content:'synthetic'}],
 models:[{modelId:'MODEL-1',provider:'Example Provider',modelName:'Example Model',version:'1.0',owner:'risk-team',purpose:'summarisation only',accessScope:'read-only'}],
 witness:{status:'accepted',reviewerId:'reviewer-1',role:'risk reviewer'},
 failures:[]
}}
test('OriginMark fingerprints and classifies source evidence',()=>{const x=buildOriginMark(payload().sources[0]);assert.match(x.contentFingerprint,/^[a-f0-9]{64}$/);assert.equal(x.evidenceClass,'observed')});
test('OriginMark rejects unsupported evidence classes',()=>assert.throws(()=>buildOriginMark({...payload().sources[0],evidenceClass:'trusted'}),/unsupported evidenceClass/));
test('ModelCensus records version, owner and access scope',()=>{const x=buildModelCensus(payload().models[0]);assert.equal(x.version,'1.0');assert.equal(x.accessScope,'read-only')});
test('ProofDocket binds decision, provenance, model, policy and witness',()=>{const x=buildProofDocket(payload(),new Date(now));assert.equal(x.schemaVersion,'keel-proof-docket-1.0');assert.equal(x.decision.decision,'ALLOW');assert.equal(x.originMarks.length,1);assert.equal(x.modelCensus.length,1);assert.equal(x.decisionWitness.status,'accepted');assert.match(x.docketFingerprint,/^[a-f0-9]{64}$/)});
test('AI inference is not promoted to verified evidence',()=>{const p=payload();p.sources[0].evidenceClass='ai_inferred';const x=buildProofDocket(p,new Date(now));assert.equal(x.originMarks[0].evidenceClass,'ai_inferred');assert.match(x.classificationBoundary.aiInferenceBoundary,/not upgraded/)});
test('FallbackMandate restricts action on provider outage',()=>{const x=buildFallbackMandate([{code:'provider_outage',detail:'provider unavailable'}]);assert.equal(x.status,'restricted');assert.equal(x.permittedAction,'manual_review');assert.equal(x.automaticFinancialExecution,false)});
test('FallbackMandate rejects unknown failure class',()=>assert.throws(()=>buildFallbackMandate([{code:'try_again'}]),/unsupported failure class/));
test('DriftSentinel requests reassessment when policy or model changes',()=>{const x=assessDrift({policyFingerprint:'a',modelFingerprint:'b'},{policyFingerprint:'c',modelFingerprint:'b'});assert.equal(x.status,'reassessment_required');assert.equal(x.changes.length,1)});
test('DriftSentinel records no material change for identical fingerprints',()=>assert.equal(assessDrift({evidenceFingerprint:'a'},{evidenceFingerprint:'a'}).status,'no_material_change_detected'));
