'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),f=require('../src/financial-state');
const now=new Date('2026-11-07T12:00:00Z');
function sample(p={}){return f.normalizeFinancialObject({objectId:'cash-1',objectType:'cash_account',currencyOrUnit:'USD',grossUnits:'100000',encumberedUnits:'25000',encumbranceStatus:'known',sourceRef:'bank-feed',externalObjectRef:'acct-1',observedAt:'2026-11-07T11:30:00Z',evidenceStatus:'verified',lifecycleStatus:'active',...p},now);}
test('canonical object has a stable SHA-256 fingerprint',()=>assert.match(sample().objectFingerprint,/^[a-f0-9]{64}$/));
test('exact integer units only; encumbrance cannot exceed gross',()=>{assert.throws(()=>sample({grossUnits:'1.2'}),/integer_units/);assert.throws(()=>sample({encumberedUnits:'100001'}),/encumbered_exceeds_gross/)});
test('available value is gross less known encumbrance',()=>assert.equal(f.assessAvailability(sample(),{},now).availableUnits,'75000'));
test('unknown encumbrance produces null availability',()=>{const a=f.assessAvailability(sample({encumberedUnits:null}),{},now);assert.equal(a.availableUnits,null);assert.ok(a.reasons.includes('ENCUMBRANCE_NOT_ESTABLISHED'))});
test('AI-inferred, stale, disputed and duplicate evidence is held',()=>{for(const p of [{evidenceStatus:'ai_inferred'},{observedAt:'2026-11-01T00:00:00Z'},{lifecycleStatus:'disputed'},{duplicateOf:'other'}])assert.equal(f.assessAvailability(sample(p),{},now).availableUnits,null)});
test('totals are separated by unit and currency',()=>{const a=sample(),b=sample({objectId:'cash-2',currencyOrUnit:'EUR',grossUnits:'500',encumberedUnits:'0',sourceRef:'feed-2',externalObjectRef:'acct-2'});assert.deepEqual(f.buildStateSnapshot([a,b],{},now).summary.totalsByUnit,{USD:'75000',EUR:'500'})});
test('duplicate IDs and missing duplicate references are rejected',()=>{const a=sample();assert.throws(()=>f.buildStateSnapshot([a,a]),/duplicate_object_id/);assert.throws(()=>f.buildStateSnapshot([sample({duplicateOf:'missing'})]),/duplicate_reference_not_found/)});
test('receivables, liabilities, commitments and restrictions are not cash available',()=>{for(const objectType of ['receivable','liability','commitment','restriction'])assert.equal(f.assessAvailability(sample({objectType}),{},now).availableUnits,null)});
