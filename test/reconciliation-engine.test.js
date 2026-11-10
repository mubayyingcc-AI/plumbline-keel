'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const engine=require('../src/reconciliation-engine');

const now='2026-11-10T13:00:00.000Z';
const expected=()=>({transferId:'transfer-001',providerId:'mto-synthetic',eventType:'payout_settled',currency:'NGN',amountMinor:'100000',dueBy:'2026-11-10T12:00:00.000Z'});
const event=(patch={})=>({eventId:'event-001',idempotencyKey:'idempotency-001',transferId:'transfer-001',providerId:'mto-synthetic',eventType:'payout_settled',currency:'NGN',amountMinor:'100000',status:'settled',occurredAt:'2026-11-10T11:59:00.000Z',...patch});

test('matches exact provider event and expected transfer',()=>{
  const r=engine.reconcile({expectedTransfers:[expected()],providerEvents:[event()],now});
  assert.equal(r.status,'MATCHED');
  assert.equal(r.summary.matched,1);
  assert.equal(r.execution,'DISABLED');
});

test('detects duplicate provider event and idempotency keys',()=>{
  const r=engine.reconcile({expectedTransfers:[expected()],providerEvents:[event(),event({eventId:'event-002'})],now});
  assert.equal(r.status,'EXCEPTIONS');
  assert.ok(r.results[0].reasons.includes('DUPLICATE_IDEMPOTENCY_KEY'));
});

test('amount mismatch is an exception, not a clean reconciliation',()=>{
  const r=engine.reconcile({expectedTransfers:[expected()],providerEvents:[event({amountMinor:'108000'})],now});
  assert.equal(r.status,'EXCEPTIONS');
  assert.ok(r.results[0].reasons.includes('AMOUNT_OVERSTATEMENT'));
  assert.equal(r.results[0].status,'EXCEPTION');
});

test('missing provider event remains unmatched',()=>{
  const r=engine.reconcile({expectedTransfers:[expected()],providerEvents:[],now});
  assert.equal(r.status,'INCOMPLETE');
  assert.equal(r.results[0].status,'UNMATCHED');
});

test('partial settlement never becomes a full match',()=>{
  const r=engine.reconcile({expectedTransfers:[expected()],providerEvents:[event({amountMinor:'40000'})],now});
  assert.equal(r.status,'INCOMPLETE');
  assert.equal(r.results[0].status,'PARTIAL');
});

test('late provider event remains an exception',()=>{
  const r=engine.reconcile({expectedTransfers:[expected()],providerEvents:[event({occurredAt:'2026-11-10T12:05:00.000Z'})],now});
  assert.equal(r.status,'EXCEPTIONS');
  assert.ok(r.results[0].reasons.includes('LATE_PROVIDER_EVENT'));
});

test('unexpected transfer event is surfaced',()=>{
  const r=engine.reconcile({expectedTransfers:[expected()],providerEvents:[event({transferId:'transfer-unknown'})],now});
  assert.equal(r.status,'EXCEPTIONS');
  assert.ok(r.results.some(x=>x.reasons.includes('UNEXPECTED_PROVIDER_EVENT')));
});

test('decimal floats and malformed currency are rejected',()=>{
  assert.throws(()=>engine.reconcile({expectedTransfers:[{...expected(),amountMinor:100000}],providerEvents:[event()],now}),/integer_minor_units/);
  assert.throws(()=>engine.reconcile({expectedTransfers:[{...expected(),currency:'US'}],providerEvents:[event()],now}),/iso_4217/);
});
