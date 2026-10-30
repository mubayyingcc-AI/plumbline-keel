const test=require('node:test'),assert=require('node:assert/strict');const {computeCapacity,evaluateAction,fingerprint}=require('../src/core');const now=new Date('2026-10-28T12:00:00.000Z');function p(){return {state:{currency:'USD',assets:[{id:'A-1',grossValue:1e7,encumberedValue:2e6,evidence:[{id:'E-1',source:'fixture',observedAt:now.toISOString(),class:'observed',encumbranceStatus:'known'}]}]},policy:{id:'P-1',version:'1',haircutRate:.1,maxEvidenceAgeMs:86400000},action:{id:'ACT-1',type:'financing_request',amount:7500000,authorized:true}}}
test('encumbrance then haircut gives $7.2m',()=>assert.equal(computeCapacity(p().state,p().policy,now).totals.capacity,7200000));
test('over-capacity action is held',()=>assert.equal(evaluateAction(p(),now).decision,'HOLD'));
test('within-capacity authorized action allowed',()=>{let x=p();x.action.amount=7e6;assert.equal(evaluateAction(x,now).decision,'ALLOW')});
test('missing authorization triggers review',()=>{let x=p();delete x.action.authorized;x.action.amount=1e6;assert.equal(evaluateAction(x,now).decision,'REVIEW')});
test('stale evidence holds and capacity is unavailable',()=>{let x=p();x.state.assets[0].evidence[0].observedAt='2026-10-20T12:00:00Z';let r=evaluateAction(x,now);assert.equal(r.decision,'HOLD');assert.equal(r.capacity.totals.capacity,null)});
test('unknown encumbrance is not treated as zero',()=>{let x=p();x.state.assets[0].evidence[0].encumbranceStatus='unknown';assert.ok(computeCapacity(x.state,x.policy,now).issues.some(i=>i.code==='UNKNOWN_ENCUMBRANCE'))});
test('duplicate relationship flagged',()=>{let x=p();x.state.assets[0].duplicateOf='OTHER';assert.ok(computeCapacity(x.state,x.policy,now).issues.some(i=>i.code==='POTENTIAL_DOUBLE_COUNT'))});
test('conflicting evidence flagged',()=>{let x=p();x.state.assets[0].evidence[0].conflict=true;assert.ok(computeCapacity(x.state,x.policy,now).issues.some(i=>i.code==='CONFLICTING_EVIDENCE'))});
test('negative amount rejected',()=>{let x=p();x.action.amount=-1;assert.throws(()=>evaluateAction(x,now),/non-negative/)});
test('fingerprint stable across object key order',()=>assert.equal(fingerprint({b:2,a:1}),fingerprint({a:1,b:2})));
test('missing encumbered value makes capacity unavailable',()=>{
  let x=p();
  delete x.state.assets[0].encumberedValue;
  const r=computeCapacity(x.state,x.policy,now);
  assert.equal(r.totals.capacity,null);
  assert.ok(r.issues.some(i=>i.code==='UNKNOWN_ENCUMBRANCE'));
});

test('null encumbered value makes capacity unavailable',()=>{
  let x=p();
  x.state.assets[0].encumberedValue=null;
  const r=computeCapacity(x.state,x.policy,now);
  assert.equal(r.totals.capacity,null);
  assert.ok(r.issues.some(i=>i.code==='UNKNOWN_ENCUMBRANCE'));
});

test('missing encumbrance status makes capacity unavailable',()=>{
  let x=p();
  delete x.state.assets[0].evidence[0].encumbranceStatus;
  const r=computeCapacity(x.state,x.policy,now);
  assert.equal(r.totals.capacity,null);
  assert.ok(r.issues.some(i=>i.code==='UNKNOWN_ENCUMBRANCE'));
});

test('NaN haircut rate is rejected',()=>{
  let x=p();
  x.policy.haircutRate=NaN;
  assert.throws(()=>computeCapacity(x.state,x.policy,now),/haircutRate/);
});

test('infinite haircut rate is rejected',()=>{
  let x=p();
  x.policy.haircutRate=Infinity;
  assert.throws(()=>computeCapacity(x.state,x.policy,now),/haircutRate/);
});

test('missing encumbrance causes action HOLD',()=>{
  let x=p();
  delete x.state.assets[0].encumberedValue;
  assert.equal(evaluateAction(x,now).decision,'HOLD');
});

test('aggregate encumbrance is unavailable when any asset is unknown',()=>{
  let x=p();
  x.state.assets.push({
    id:'A-2',
    grossValue:5000000,
    evidence:[{
      id:'E-2',
      source:'fixture',
      observedAt:now.toISOString(),
      class:'observed',
      encumbranceStatus:'known'
    }]
  });

  const r=computeCapacity(x.state,x.policy,now);
  assert.equal(r.totals.encumberedValue,null);
  assert.equal(r.totals.capacity,null);
});

test('unknown evidence status makes aggregate encumbrance unavailable',()=>{
  let x=p();
  x.state.assets[0].evidence[0].encumbranceStatus='unknown';

  const r=computeCapacity(x.state,x.policy,now);
  assert.equal(r.totals.encumberedValue,null);
  assert.equal(r.totals.capacity,null);
});

test('aggregate gross overflow is rejected',()=>{
  let x=p();

  x.state.assets[0].grossValue=1e308;
  x.state.assets[0].encumberedValue=0;

  x.state.assets.push({
    id:'A-OVERFLOW',
    grossValue:1e308,
    encumberedValue:0,
    evidence:[{
      id:'E-OVERFLOW',
      source:'fixture',
      observedAt:now.toISOString(),
      class:'observed',
      encumbranceStatus:'known'
    }]
  });

  assert.throws(
    ()=>computeCapacity(x.state,x.policy,now),
    /aggregate gross value exceeds supported numeric range/
  );
});
