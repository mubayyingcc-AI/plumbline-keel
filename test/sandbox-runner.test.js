'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const runner=require('../src/sandbox-runner');
const now=new Date('2026-11-09T12:00:00.000Z');
test('KFS-001 executes the actual evaluator against a fresh synthetic fixture',()=>{
 const r=runner.runPublicScenario('KFS-001',undefined,now);
 assert.equal(r.status,'PASSED');assert.equal(r.actual.decision,'ALLOW');assert.equal(r.actual.capacity,7200000);
 assert.ok(r.assertions.every(a=>a.passed));assert.match(r.recordFingerprint,/^[a-f0-9]{64}$/);
 assert.equal(r.dataClass,'synthetic');assert.equal(r.signature.status,'NOT_SIGNED');assert.equal(r.persistence.status,'NOT_PERSISTED');
});
test('KFS-002 holds stale evidence and reports the stale evidence assertion',()=>{
 const r=runner.runPublicScenario('KFS-002',undefined,now);
 assert.equal(r.status,'PASSED');assert.equal(r.actual.decision,'HOLD');assert.equal(r.actual.capacity,null);
 assert.ok(r.assertions.every(a=>a.passed));assert.ok(r.actual.evidenceIssues.some(x=>x.code==='STALE_EVIDENCE'));
});
test('unknown scenario is rejected rather than treated as a pass',()=>{
 assert.throws(()=>runner.runPublicScenario('KFS-999'),/unsupported_public_sandbox_scenario/);
});
test('a failing engine assertion is retained as FAILED',()=>{
 const r=runner.runPublicScenario('KFS-001',()=>({schemaVersion:'test',decision:'HOLD',capacity:{totals:{capacity:null},issues:[{code:'TEST'}]},recordFingerprint:'0'.repeat(64)}),now);
 assert.equal(r.status,'FAILED');assert.ok(r.assertions.some(a=>!a.passed));
});
