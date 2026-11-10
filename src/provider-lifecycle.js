'use strict';

const crypto = require('node:crypto');
const { canonical } = require('./authority-chain');
const authorityPersistence = require('./authority-persistence');
security/global-financial-core-tenant-assurance

const { appendLedgerEvent } = require('./ledger-event-chain');
 main

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const EVENT_STATUSES = new Set(['accepted','pending','cleared','settled','reversed','failed','unknown']);
const verifiedAttestations = new WeakSet();

function fail(code,status=400){const e=new Error(code);e.status=status;throw e;}
function required(v,name,max=160){
  if(typeof v!=='string'||!v.trim()||v.trim().length>max)fail(name+'_invalid');
  return v.trim();
}
function tenant(v){if(typeof v!=='string'||!UUID.test(v))fail('tenant_id_invalid');return v;}
function idempotency(v){if(typeof v!=='string'||!KEY.test(v))fail('idempotency_key_invalid');return v;}
function object(v){
  if(!v||typeof v!=='object'||Array.isArray(v))fail('payload_object_required');
  let copy;try{copy=JSON.parse(JSON.stringify(v));}catch(_){fail('payload_not_json_serializable');}
  if(!copy||Array.isArray(copy)||typeof copy!=='object')fail('payload_object_required');
  return copy;
}
function digest(v){return crypto.createHash('sha256').update(canonical(v)).digest('hex');}
function verifyHmacSha256({rawBody,signature,secret,keyId,verifiedAt=new Date().toISOString()}){
  if(typeof rawBody!=='string'||!rawBody.length||Buffer.byteLength(rawBody)>1024*1024)fail('provider_raw_body_invalid');
  if(typeof secret!=='string'||Buffer.byteLength(secret)<32)fail('provider_webhook_secret_too_short');
  const id=required(keyId,'verification_key_id',160);
  if(typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/i.test(signature))fail('provider_signature_format_invalid',403);
  if(!Number.isFinite(Date.parse(verifiedAt)))fail('provider_signature_verification_time_invalid');
  const expected=crypto.createHmac('sha256',secret).update(rawBody,'utf8').digest();
  const supplied=Buffer.from(signature.slice(7),'hex');
  if(supplied.length!==expected.length||!crypto.timingSafeEqual(expected,supplied))fail('provider_signature_invalid',403);
  const attestation=Object.freeze({status:'verified',keyId:id,verifiedAt,algorithm:'hmac-sha256',rawBodyFingerprint:crypto.createHash('sha256').update(rawBody).digest('hex')});
  verifiedAttestations.add(attestation);return attestation;
}
function assertTenantContext(client,tenantId){
  return client.query("SELECT current_setting('keel.tenant_id',true) AS tenant_id").then(r=>{
    if(!r.rowCount||r.rows[0].tenant_id!==tenantId)fail('provider_lifecycle_tenant_context_mismatch',403);
  });
}
function requireClient(client){if(!client||typeof client.query!=='function')fail('database_transaction_client_required',503);}

async function enqueueInstruction(client,input){
  requireClient(client);
  const tenantId=tenant(input.tenantId);
  await assertTenantContext(client,tenantId);
  const journalId=required(input.journalId,'journal_id',160);
  const providerId=required(input.providerId,'provider_id',120);
  const aggregateType=required(input.aggregateType,'aggregate_type',80);
  const aggregateId=required(input.aggregateId,'aggregate_id',160);
  const instructionType=required(input.instructionType,'instruction_type',100);
  const key=idempotency(input.idempotencyKey);
  const payload=object(input.payload);
  const payloadFingerprint=digest(payload);
  const journal=await client.query(
    "SELECT status FROM keel_ledger_journals WHERE tenant_id=$1 AND journal_id=$2 FOR SHARE",
    [tenantId,journalId]
  );
  if(!journal.rowCount||journal.rows[0].status!=='posted')fail('provider_instruction_requires_posted_ledger_journal',409);
  const outboxId=input.outboxId||crypto.randomUUID();
  if(!UUID.test(outboxId))fail('outbox_id_invalid');
  const inserted=await client.query(
    `INSERT INTO keel_provider_outbox
      (tenant_id,outbox_id,journal_id,provider_id,aggregate_type,aggregate_id,instruction_type,idempotency_key,payload,payload_fingerprint)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
     ON CONFLICT(tenant_id,provider_id,idempotency_key) DO NOTHING
     RETURNING outbox_id,status,payload_fingerprint`,
    [tenantId,outboxId,journalId,providerId,aggregateType,aggregateId,instructionType,key,JSON.stringify(payload),payloadFingerprint]
  );
  if(inserted.rowCount)return {...inserted.rows[0],replay:false};
  const prior=await client.query(
    'SELECT outbox_id,journal_id,aggregate_type,aggregate_id,instruction_type,payload_fingerprint,status FROM keel_provider_outbox WHERE tenant_id=$1 AND provider_id=$2 AND idempotency_key=$3 FOR UPDATE',
    [tenantId,providerId,key]
  );
  if(!prior.rowCount)fail('provider_outbox_idempotency_race',409);
  const p=prior.rows[0];
  if(p.journal_id!==journalId||p.aggregate_type!==aggregateType||p.aggregate_id!==aggregateId||p.instruction_type!==instructionType||p.payload_fingerprint!==payloadFingerprint)fail('provider_outbox_idempotency_conflict',409);
  return {...p,replay:true};
}

async function withTenantTransaction(pool,tenantId,work){
  if(!pool||typeof pool.connect!=='function')fail('provider_lifecycle_storage_unavailable',503);
  tenant(tenantId);
  for(let attempt=1;attempt<=3;attempt++){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      await client.query("SELECT set_config('keel.tenant_id',$1,true)",[tenantId]);
      const result=await work(client);
      await client.query('COMMIT');
      return result;
    }catch(e){
      await client.query('ROLLBACK').catch(()=>{});
      if((e.code==='40001'||e.code==='40P01')&&attempt<3)continue;
      throw e;
    }finally{client.release();}
  }
  fail('provider_lifecycle_transaction_retry_exhausted',409);
}

 security/global-financial-core-tenant-assurance
async function claimNextInstruction(pool,tenantId,workerId,leaseSeconds=45,authorityContext){
  const worker=required(workerId,'worker_id',120);
  if(!Number.isInteger(leaseSeconds)||leaseSeconds<10||leaseSeconds>300)fail('lease_seconds_invalid');
  if(!authorityContext)fail('provider_dispatch_authority_context_required',403);
  return withTenantTransaction(pool,tenantId,async client=>{
    // A worker may have sent before crashing. Authorize each expiry transition; never silently mutate it.
    const expired=await client.query("SELECT outbox_id,journal_id,provider_id,idempotency_key,payload,payload_fingerprint FROM keel_provider_outbox WHERE tenant_id=$1 AND status='leased' AND lease_until<=NOW() ORDER BY lease_until FOR UPDATE SKIP LOCKED",[tenantId]);
    
async function claimNextInstruction(pool,tenantId,workerId,leaseSeconds=45,authorityContext,allowedProviderIds=['bank-sandbox']){
  const worker=required(workerId,'worker_id',120);
  if(!Number.isInteger(leaseSeconds)||leaseSeconds<10||leaseSeconds>300)fail('lease_seconds_invalid');
  if(!authorityContext||!authorityContext.actor||!authorityContext.actor.principal_id||worker!==authorityContext.actor.principal_id)fail('provider_dispatch_authority_context_required',403);
  if(!Array.isArray(allowedProviderIds)||!allowedProviderIds.length||allowedProviderIds.some(x=>typeof x!=='string'||!x.trim()))fail('provider_allowlist_required',403);
  return withTenantTransaction(pool,tenantId,async client=>{
    const expired=await client.query("SELECT outbox_id,journal_id,provider_id,idempotency_key,payload,payload_fingerprint FROM keel_provider_outbox WHERE tenant_id=$1 AND status='leased' AND lease_until<=NOW() AND provider_id=ANY($2::text[]) ORDER BY lease_until FOR UPDATE SKIP LOCKED",[tenantId,allowedProviderIds]);
>>  main
    for(const row of expired.rows){
      const payload=row.payload||{};
      if(typeof payload.currency!=='string'||!/^[A-Z]{3}$/.test(payload.currency)||typeof payload.amountMinor!=='string'||!/^(0|[1-9][0-9]*)$/.test(payload.amountMinor))fail('provider_expired_lease_financial_amount_and_currency_required',400);
      const recoveryRequest={tenantId,journalId:row.journal_id,outboxId:row.outbox_id,providerId:row.provider_id,payloadFingerprint:row.payload_fingerprint,idempotencyKey:row.idempotency_key,recovery:'expired_lease_to_unknown'};
<<    security/global-financial-core-tenant-assurance
      await authorityPersistence.authorizeAndRecord(client,{...authorityContext,tenantId,action:'provider:instruction:recover_expired',resourceId:'provider:'+row.provider_id,amountMinor:payload.amountMinor,currency:payload.currency,requestFingerprint:authorityPersistence.digest(recoveryRequest),executionRef:row.outbox_id});
      await client.query("UPDATE keel_provider_outbox SET status='unknown',lease_owner=NULL,lease_until=NULL,last_error_code='DISPATCH_LEASE_EXPIRED_OUTCOME_UNKNOWN',updated_at=NOW() WHERE tenant_id=$1 AND outbox_id=$2 AND status='leased' AND lease_until<=NOW()",[tenantId,row.outbox_id]);
    }
    const claimed=await client.query(
      `SELECT outbox_id,journal_id,provider_id,aggregate_type,aggregate_id,instruction_type,idempotency_key,payload,payload_fingerprint,attempts
         FROM keel_provider_outbox
        WHERE tenant_id=$1 AND status='queued' AND available_at<=NOW() AND attempts<max_attempts
        ORDER BY available_at,created_at
        FOR UPDATE SKIP LOCKED LIMIT 1`,
      [tenantId]
    );
    if(!claimed.rowCount)return null;
    const row=claimed.rows[0];
    const payload=row.payload||{};
    if(typeof payload.currency!=='string'||!/^[A-Z]{3}$/.test(payload.currency)||typeof payload.amountMinor!=='string'||!/^(0|[1-9][0-9]*)$/.test(payload.amountMinor))fail('provider_dispatch_financial_amount_and_currency_required',400);
    const dispatchRequest={tenantId,journalId:row.journal_id,outboxId:row.outbox_id,providerId:row.provider_id,payloadFingerprint:row.payload_fingerprint,idempotencyKey:row.idempotency_key};
    const authorityProof=await authorityPersistence.authorizeAndRecord(client,{...authorityContext,tenantId,action:'provider:instruction:dispatch',resourceId:'provider:'+row.provider_id,amountMinor:payload.amountMinor,currency:payload.currency,requestFingerprint:authorityPersistence.digest(dispatchRequest),executionRef:row.outbox_id});
    const updated=await client.query(
      `UPDATE keel_provider_outbox SET status='leased',attempts=attempts+1,lease_owner=$3,
              lease_until=NOW()+($4::integer * INTERVAL '1 second'),updated_at=NOW()
        WHERE tenant_id=$1 AND outbox_id=$2 AND status='queued'
        RETURNING attempts,lease_until`,
      [tenantId,row.outbox_id,worker,leaseSeconds]
    );
    if(!updated.rowCount)fail('provider_outbox_claim_race',409);
==
      const recoveryProof=await authorityPersistence.authorizeAndRecord(client,{...authorityContext,tenantId,action:'provider:instruction:recover_expired',resourceId:'provider:'+row.provider_id,amountMinor:payload.amountMinor,currency:payload.currency,requestFingerprint:authorityPersistence.digest(recoveryRequest),executionRef:row.outbox_id});
      await client.query("UPDATE keel_provider_outbox SET status='unknown',lease_owner=NULL,lease_until=NULL,last_error_code='DISPATCH_LEASE_EXPIRED_OUTCOME_UNKNOWN',updated_at=NOW() WHERE tenant_id=$1 AND outbox_id=$2 AND status='leased' AND lease_until<=NOW()",[tenantId,row.outbox_id]);
      await appendLedgerEvent(client,tenantId,'AUTHORITY_ACTION_PROVEN',recoveryProof.proofId,{action:'provider:instruction:recover_expired',envelopeId:recoveryProof.envelopeId,requestFingerprint:recoveryProof.requestFingerprint,executionRef:row.outbox_id});
    }
    const claimed=await client.query(`SELECT outbox_id,journal_id,provider_id,aggregate_type,aggregate_id,instruction_type,idempotency_key,payload,payload_fingerprint,attempts
      FROM keel_provider_outbox WHERE tenant_id=$1 AND status='queued' AND available_at<=NOW() AND attempts<max_attempts AND provider_id=ANY($2::text[])
      ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1`,[tenantId,allowedProviderIds]);
    if(!claimed.rowCount)return null;
    const row=claimed.rows[0],payload=row.payload||{};
    if(typeof payload.currency!=='string'||!/^[A-Z]{3}$/.test(payload.currency)||typeof payload.amountMinor!=='string'||!/^(0|[1-9][0-9]*)$/.test(payload.amountMinor))fail('provider_dispatch_financial_amount_and_currency_required',400);
    const dispatchRequest={tenantId,journalId:row.journal_id,outboxId:row.outbox_id,providerId:row.provider_id,payloadFingerprint:row.payload_fingerprint,idempotencyKey:row.idempotency_key};
    const authorityProof=await authorityPersistence.authorizeAndRecord(client,{...authorityContext,tenantId,action:'provider:instruction:dispatch',resourceId:'provider:'+row.provider_id,amountMinor:payload.amountMinor,currency:payload.currency,requestFingerprint:authorityPersistence.digest(dispatchRequest),executionRef:row.outbox_id});
    const updated=await client.query(`UPDATE keel_provider_outbox SET status='leased',attempts=attempts+1,lease_owner=$3,lease_until=NOW()+($4::integer*INTERVAL '1 second'),updated_at=NOW()
      WHERE tenant_id=$1 AND outbox_id=$2 AND status='queued' RETURNING attempts,lease_until`,[tenantId,row.outbox_id,worker,leaseSeconds]);
    if(!updated.rowCount)fail('provider_outbox_claim_race',409);
    await appendLedgerEvent(client,tenantId,'AUTHORITY_ACTION_PROVEN',authorityProof.proofId,{action:'provider:instruction:dispatch',envelopeId:authorityProof.envelopeId,requestFingerprint:authorityProof.requestFingerprint,executionRef:row.outbox_id});
>>  main
    return {...row,attempts:updated.rows[0].attempts,leaseUntil:updated.rows[0].lease_until,authorityProof};
  });
}
async function recordDispatchOutcome(pool,tenantId,input,authorityContext){
  const outboxId=required(input.outboxId,'outbox_id',80);
  const worker=required(input.workerId,'worker_id',120);
  const outcome=input.outcome;
  if(!['accepted','unknown','failed'].includes(outcome))fail('provider_dispatch_outcome_invalid');
  const safeToRetry=input.safeToRetry===true;
  if(safeToRetry&&outcome!=='failed')fail('only_definitive_pre_send_failure_may_be_retried');
  const retryAfterSeconds=input.retryAfterSeconds===undefined?60:input.retryAfterSeconds;
  if(!Number.isInteger(retryAfterSeconds)||retryAfterSeconds<1||retryAfterSeconds>86400)fail('retry_after_invalid');
  const providerInstructionId=input.providerInstructionId?required(input.providerInstructionId,'provider_instruction_id',200):null;
  const errorCode=input.errorCode?required(input.errorCode,'provider_error_code',120):null;
  if(!authorityContext||!authorityContext.actor||!authorityContext.actor.principal_id||worker!==authorityContext.actor.principal_id)fail('provider_outcome_authority_context_required',403);
  return withTenantTransaction(pool,tenantId,async client=>{
    const current=await client.query(
      'SELECT status,lease_owner FROM keel_provider_outbox WHERE tenant_id=$1 AND outbox_id=$2 FOR UPDATE',
      [tenantId,outboxId]
    );
    if(!current.rowCount)fail('provider_outbox_not_found',404);
    if(current.rows[0].status!=='leased'||current.rows[0].lease_owner!==worker)fail('provider_outbox_lease_not_owned',409);
    const row=await client.query('SELECT provider_id,payload,payload_fingerprint,journal_id,idempotency_key FROM keel_provider_outbox WHERE tenant_id=$1 AND outbox_id=$2',[tenantId,outboxId]);
    const payload=row.rows[0].payload||{};
    if(typeof payload.currency!=='string'||!/^[A-Z]{3}$/.test(payload.currency)||typeof payload.amountMinor!=='string'||!/^(0|[1-9][0-9]*)$/.test(payload.amountMinor))fail('provider_outcome_financial_amount_and_currency_required',400);
    const request={tenantId,outboxId,providerId:row.rows[0].provider_id,payloadFingerprint:row.rows[0].payload_fingerprint,outcome,safeToRetry,retryAfterSeconds,providerInstructionId,errorCode};
    const proof=await authorityPersistence.authorizeAndRecord(client,{...authorityContext,tenantId,action:'provider:instruction:outcome',resourceId:'provider:'+row.rows[0].provider_id,amountMinor:payload.amountMinor,currency:payload.currency,requestFingerprint:authorityPersistence.digest(request),executionRef:outboxId});
    const next=safeToRetry?'queued':outcome;
    const result=await client.query(
      `UPDATE keel_provider_outbox SET status=$3,available_at=CASE WHEN $3='queued' THEN NOW()+($4::integer*INTERVAL '1 second') ELSE available_at END,
         lease_owner=NULL,lease_until=NULL,provider_instruction_id=COALESCE($5,provider_instruction_id),
         last_error_code=$6,updated_at=NOW()
       WHERE tenant_id=$1 AND outbox_id=$2
       RETURNING outbox_id,status,attempts,provider_instruction_id,last_error_code`,
      [tenantId,outboxId,next,retryAfterSeconds,providerInstructionId,errorCode]
    );
    await appendLedgerEvent(client,tenantId,'AUTHORITY_ACTION_PROVEN',proof.proofId,{action:'provider:instruction:outcome',envelopeId:proof.envelopeId,requestFingerprint:proof.requestFingerprint,executionRef:outboxId});
    return {...result.rows[0],authorityProof:proof};
  });
}

async function recordVerifiedProviderEvent(client,input){
  requireClient(client);
  const tenantId=tenant(input.tenantId);
  await assertTenantContext(client,tenantId);
  const providerId=required(input.providerId,'provider_id',120);
  const providerEventId=required(input.providerEventId,'provider_event_id',200);
  const key=idempotency(input.idempotencyKey);
  const eventType=required(input.eventType,'event_type',100);
  const status=required(input.status,'event_status',20).toLowerCase();
  if(!EVENT_STATUSES.has(status))fail('provider_event_status_invalid');
  const occurredAt=input.occurredAt;
  if(typeof occurredAt!=='string'||!Number.isFinite(Date.parse(occurredAt)))fail('provider_event_timestamp_invalid');
  const payload=object(input.payload);
  const verification=input.verification;
  if(!verification||!verifiedAttestations.has(verification)||typeof input.rawBody!=='string'||verification.rawBodyFingerprint!==crypto.createHash('sha256').update(input.rawBody).digest('hex'))fail('provider_event_signature_verification_required',403);
  let signedBody;try{signedBody=JSON.parse(input.rawBody);}catch(_){fail('provider_signed_body_invalid',403);}
  if(signedBody.providerEventId!==providerEventId||signedBody.idempotencyKey!==key||signedBody.eventType!==eventType||String(signedBody.status).toLowerCase()!==status||signedBody.occurredAt!==occurredAt||canonical(signedBody.payload)!==canonical(payload))fail('provider_signed_body_event_mismatch',403);
  const payloadFingerprint=digest({providerId,providerEventId,key,eventType,status,occurredAt,payload});
  const inboxId=input.inboxId||crypto.randomUUID();
  if(!UUID.test(inboxId))fail('inbox_id_invalid');
  const inserted=await client.query(
    `INSERT INTO keel_provider_inbox
      (tenant_id,inbox_id,provider_id,provider_event_id,idempotency_key,event_type,event_status,payload,payload_fingerprint,
       signature_verified,verification_key_id,verified_at,occurred_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,TRUE,$10,$11,$12)
     ON CONFLICT(tenant_id,provider_id,provider_event_id) DO NOTHING
     RETURNING inbox_id,processing_status,payload_fingerprint`,
    [tenantId,inboxId,providerId,providerEventId,key,eventType,status,JSON.stringify(payload),payloadFingerprint,verification.keyId.trim(),verification.verifiedAt,occurredAt]
  );
  if(inserted.rowCount)return {...inserted.rows[0],replay:false};
  const prior=await client.query(
    'SELECT inbox_id,payload_fingerprint,processing_status FROM keel_provider_inbox WHERE tenant_id=$1 AND provider_id=$2 AND provider_event_id=$3 FOR UPDATE',
    [tenantId,providerId,providerEventId]
  );
  if(!prior.rowCount||prior.rows[0].payload_fingerprint!==payloadFingerprint)fail('provider_event_replay_conflict',409);
  return {...prior.rows[0],replay:true};
}

async function reconcileProviderEvent(client,tenantId,inboxId){
  requireClient(client);
  tenant(tenantId);
  await assertTenantContext(client,tenantId);
  const event=await client.query(
    'SELECT inbox_id,provider_id,idempotency_key,event_status,payload,payload_fingerprint,signature_verified FROM keel_provider_inbox WHERE tenant_id=$1 AND inbox_id=$2 FOR UPDATE',
    [tenantId,inboxId]
  );
  if(!event.rowCount)fail('provider_inbox_event_not_found',404);
  const e=event.rows[0];
  if(!e.signature_verified)fail('provider_event_not_verified',403);
  const instruction=await client.query(
    'SELECT outbox_id,provider_id,payload,payload_fingerprint,status FROM keel_provider_outbox WHERE tenant_id=$1 AND provider_id=$2 AND idempotency_key=$3 FOR UPDATE',
    [tenantId,e.provider_id,e.idempotency_key]
  );
  const reasons=[];
  if(!instruction.rowCount)reasons.push('NO_MATCHING_OUTBOX_INSTRUCTION');
  else{
    const expected=instruction.rows[0].payload||{};
    const observed=e.payload||{};
    if(expected.currency!==observed.currency)reasons.push('CURRENCY_MISMATCH');
    if(String(expected.amountMinor)!==String(observed.amountMinor))reasons.push('AMOUNT_MISMATCH');
    if(e.event_status==='failed'||e.event_status==='reversed')reasons.push('PROVIDER_REPORTED_NON_SETTLEMENT');
    if(e.event_status==='unknown')reasons.push('PROVIDER_OUTCOME_UNKNOWN');
  }
  const caseId=crypto.randomUUID();
  const status=reasons.length?'exception':(['accepted','pending','cleared'].includes(e.event_status)?'pending':'matched');
  await client.query(
    `INSERT INTO keel_provider_reconciliation_cases
      (tenant_id,case_id,outbox_id,inbox_id,status,reason_codes,expected_fingerprint,observed_fingerprint,resolved_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $5='matched' THEN NOW() ELSE NULL END)
     ON CONFLICT(tenant_id,inbox_id) WHERE inbox_id IS NOT NULL DO NOTHING`,
    [tenantId,caseId,instruction.rowCount?instruction.rows[0].outbox_id:null,inboxId,status,reasons,
      instruction.rowCount?instruction.rows[0].payload_fingerprint:null,e.payload_fingerprint]
  );
  await client.query("UPDATE keel_provider_inbox SET processing_status=CASE WHEN $3='exception' THEN 'quarantined' ELSE 'processed' END WHERE tenant_id=$1 AND inbox_id=$2 AND processing_status='received'",[tenantId,inboxId,status]);
  if(instruction.rowCount&&status==='matched')await client.query("UPDATE keel_provider_outbox SET status='reconciled',lease_owner=NULL,lease_until=NULL,updated_at=NOW() WHERE tenant_id=$1 AND outbox_id=$2",[tenantId,instruction.rows[0].outbox_id]);
  if(instruction.rowCount&&e.event_status==='failed')await client.query("UPDATE keel_provider_outbox SET status='failed',lease_owner=NULL,lease_until=NULL,last_error_code='PROVIDER_REPORTED_FAILURE',updated_at=NOW() WHERE tenant_id=$1 AND outbox_id=$2",[tenantId,instruction.rows[0].outbox_id]);
  const prior=await client.query('SELECT case_id,status,reason_codes FROM keel_provider_reconciliation_cases WHERE tenant_id=$1 AND inbox_id=$2',[tenantId,inboxId]);
  return {...prior.rows[0],execution:'DISABLED',notice:'Provider event was matched against a durable instruction only. No ledger posting, settlement assertion, reversal or write-off was performed.'};
}

module.exports={
  enqueueInstruction,claimNextInstruction,recordDispatchOutcome,
  verifyHmacSha256,recordVerifiedProviderEvent,reconcileProviderEvent,withTenantTransaction,
  digest
};
