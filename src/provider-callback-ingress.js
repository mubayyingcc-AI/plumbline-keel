'use strict';
const lifecycle=require('./provider-lifecycle');
const {appendLedgerEvent}=require('./ledger-event-chain');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function ingestCallback({pool,adapter,rawBody,signature,keyId}){
 if(!pool||!adapter)throw new Error('provider_callback_ingress_configuration_required');
 const verified=adapter.verifyCallback({rawBody,signature,keyId});
 const e=verified.event;
 if(typeof e.tenantId!=='string'||!UUID.test(e.tenantId))throw new Error('provider_callback_tenant_id_invalid');
 const required=['providerEventId','idempotencyKey','eventType','status','occurredAt'];
 for(const field of required)if(typeof e[field]!=='string'||!e[field].trim())throw new Error('provider_callback_'+field+'_required');
 if(!e.payload||typeof e.payload!=='object'||Array.isArray(e.payload))throw new Error('provider_callback_payload_required');
 return lifecycle.withTenantTransaction(pool,e.tenantId,async client=>{
  const inbox=await lifecycle.recordVerifiedProviderEvent(client,{tenantId:e.tenantId,providerId:e.providerId,providerEventId:e.providerEventId,idempotencyKey:e.idempotencyKey,eventType:e.eventType,status:e.status,occurredAt:e.occurredAt,payload:e.payload,rawBody,verification:verified.attestation});
  const reconciliation=await lifecycle.reconcileProviderEvent(client,e.tenantId,inbox.inbox_id);
  await appendLedgerEvent(client,e.tenantId,'AUTHORITY_ACTION_PROVEN',inbox.inbox_id,{action:'provider:callback:verified',providerId:e.providerId,providerEventId:e.providerEventId,keyId:verified.attestation.keyId,rawBodyFingerprint:verified.attestation.rawBodyFingerprint,replay:inbox.replay,reconciliationCaseId:reconciliation.case_id||null,reconciliationStatus:reconciliation.status||null});
  return {inboxId:inbox.inbox_id,replay:inbox.replay,reconciliation};
 });
}
module.exports={ingestCallback};
