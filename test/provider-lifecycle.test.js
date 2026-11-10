'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const lifecycle=require('../src/provider-lifecycle');

const tenant='11111111-1111-4111-8111-111111111111';

test('provider HMAC verifier accepts a valid signature and rejects a modified body',()=>{
  const rawBody=JSON.stringify({event:'settled'});
  const secret='unit-test-webhook-secret-with-32-bytes';
  const signature='sha256='+crypto.createHmac('sha256',secret).update(rawBody).digest('hex');
  const attestation=lifecycle.verifyHmacSha256({rawBody,signature,secret,keyId:'test-key'});
  assert.equal(attestation.status,'verified');
  assert.throws(()=>lifecycle.verifyHmacSha256({rawBody:rawBody+' ',signature,secret,keyId:'test-key'}),/provider_signature_invalid/);
});
test('provider HMAC verifier rejects short secrets and malformed signatures',()=>{
  assert.throws(()=>lifecycle.verifyHmacSha256({rawBody:'{}',signature:'bad',secret:'short',keyId:'test'}),/provider_webhook_secret_too_short/);
});
test('provider payload fingerprint is stable across object key order',()=>{
  assert.equal(lifecycle.digest({a:1,b:{x:2,y:3}}),lifecycle.digest({b:{y:3,x:2},a:1}));
});
test('provider payload fingerprint changes when a value changes',()=>{
  assert.notEqual(lifecycle.digest({amountMinor:'100',currency:'USD'}),lifecycle.digest({amountMinor:'101',currency:'USD'}));
});
test('outbox enqueue requires a transaction client',async()=>{
  await assert.rejects(()=>lifecycle.enqueueInstruction(null,{tenantId:tenant}),/database_transaction_client_required/);
});
test('provider event cannot be recorded without a cryptographic attestation',async()=>{
  const client={query:async()=>({rowCount:1,rows:[{tenant_id:tenant}]})};
  await assert.rejects(()=>lifecycle.recordVerifiedProviderEvent(client,{
    tenantId:tenant,providerId:'bank-x',providerEventId:'evt-1',idempotencyKey:'provider-event-key-0001',
    eventType:'payment.status',status:'settled',occurredAt:new Date().toISOString(),payload:{amountMinor:'500',currency:'USD'},
    verification:{status:'verified',keyId:'bank-key-1',verifiedAt:new Date().toISOString()}
  }),/provider_event_signature_verification_required/);
});
test('provider event status rejects unsupported states before persistence',async()=>{
  const client={query:async()=>({rowCount:1,rows:[{tenant_id:tenant}]})};
  await assert.rejects(()=>lifecycle.recordVerifiedProviderEvent(client,{
    tenantId:tenant,providerId:'bank-x',providerEventId:'evt-1',idempotencyKey:'provider-event-key-0001',
    eventType:'payment.status',status:'complete-ish',occurredAt:new Date().toISOString(),payload:{}
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

 security/global-financial-core-tenant-assurance
test('provider dispatch fails closed without a named delegated authority context before database access',async()=>{await assert.rejects(()=>lifecycle.claimNextInstruction({},tenant,'worker-without-authority',30),/provider_dispatch_authority_context_required/);});

test('provider dispatch fails closed without delegated authority before database access',async()=>{await assert.rejects(()=>lifecycle.claimNextInstruction({},tenant,'worker-without-authority',30),/provider_dispatch_authority_context_required/);});
test('provider outcome fails closed without delegated authority before database access',async()=>{await assert.rejects(()=>lifecycle.recordDispatchOutcome({},tenant,{outboxId:'outbox-1',workerId:'worker-1',outcome:'unknown'}),/provider_outcome_authority_context_required/);});
 main
