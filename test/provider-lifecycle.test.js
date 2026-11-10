'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const lifecycle=require('../src/provider-lifecycle');

const tenant='11111111-1111-4111-8111-111111111111';
test('provider payload fingerprint is stable across object key order',()=>{
  assert.equal(lifecycle.digest({a:1,b:{x:2,y:3}}),lifecycle.digest({b:{y:3,x:2},a:1}));
});
test('provider payload fingerprint changes when a value changes',()=>{
  assert.notEqual(lifecycle.digest({amountMinor:'100',currency:'USD'}),lifecycle.digest({amountMinor:'101',currency:'USD'}));
});
test('outbox enqueue requires a transaction client',async()=>{
  await assert.rejects(()=>lifecycle.enqueueInstruction(null,{tenantId:tenant}),/database_transaction_client_required/);
});
test('provider event cannot be recorded without explicit verified signature metadata',async()=>{
  const client={query:async(sql)=>({rowCount:1,rows:[{tenant_id:tenant}]})};
  await assert.rejects(()=>lifecycle.recordVerifiedProviderEvent(client,{
    tenantId:tenant,providerId:'bank-x',providerEventId:'evt-1',idempotencyKey:'provider-event-key-0001',
    eventType:'payment.status',status:'settled',occurredAt:new Date().toISOString(),payload:{amountMinor:'500',currency:'USD'}
  }),/provider_event_signature_verification_required/);
});
test('provider event status rejects unsupported states',async()=>{
  const client={query:async(sql)=>({rowCount:1,rows:[{tenant_id:tenant}]})};
  await assert.rejects(()=>lifecycle.recordVerifiedProviderEvent(client,{
    tenantId:tenant,providerId:'bank-x',providerEventId:'evt-1',idempotencyKey:'provider-event-key-0001',
    eventType:'payment.status',status:'complete-ish',occurredAt:new Date().toISOString(),payload:{},
    verification:{status:'verified',keyId:'bank-key-1',verifiedAt:new Date().toISOString()}
  }),/provider_event_status_invalid/);
});
test('only definitive pre-send failure can be retried',async()=>{
  await assert.rejects(()=>lifecycle.recordDispatchOutcome({},tenant,{
    outboxId:'11111111-1111-4111-8111-111111111112',workerId:'worker-1',
    outcome:'unknown',safeToRetry:true
  }),/only_definitive_pre_send_failure_may_be_retried/);
});
test('lease bounds prevent unbounded provider dispatch leases',async()=>{
  await assert.rejects(()=>lifecycle.claimNextInstruction({},tenant,'worker-1',999),/lease_seconds_invalid/);
});
