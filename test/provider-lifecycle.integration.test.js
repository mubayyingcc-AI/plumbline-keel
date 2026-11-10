'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const url=process.env.KEEL_LEDGER_TEST_DATABASE_URL;
const posting=require('../src/ledger-posting');
const lifecycle=require('../src/provider-lifecycle');
const periods=require('../src/accounting-periods');
const authority=require('../src/authority-persistence');
const callbackIngress=require('../src/provider-callback-ingress');
const {ProviderSandboxAdapter,createDeterministicSandboxTransport}=require('../src/provider-sandbox-adapter');

test('provider outbox/inbox is tenant-bound, durable, idempotent and never auto-posts settlement',{skip:!url&&'Set KEEL_LEDGER_TEST_DATABASE_URL to disposable PostgreSQL with migrations 012-019 applied'},async()=>{
  const {Pool}=require('pg');
  const pool=new Pool({connectionString:url,max:6});
  const admin=new Pool({connectionString:process.env.PG_ADMIN_URL,max:2});
  const tenantId=crypto.randomUUID(),suffix=crypto.randomUUID().replace(/-/g,'').slice(0,10);
  try{
    await admin.query("INSERT INTO keel_tenants(tenant_id,tenant_name,tenant_slug,status) VALUES($1,$2,$3,'active')",[tenantId,'Provider lifecycle '+suffix,'provider-'+suffix]);
    const cash='provider-cash-'+suffix,liability='provider-liability-'+suffix;
    await posting.createAccount(pool,tenantId,{accountId:cash,accountCode:'PC-'+suffix,accountName:'Provider clearing cash',accountClass:'asset',currency:'USD',currencyExponent:2,normalSide:'debit'});
    await posting.createAccount(pool,tenantId,{accountId:liability,accountCode:'PL-'+suffix,accountName:'Provider payable',accountClass:'liability',currency:'USD',currencyExponent:2,normalSide:'credit'});
    const bookId='provider-book-'+suffix,periodId='provider-period-'+suffix;
    await periods.createBook(pool,tenantId,{bookId,entityId:'entity-'+suffix,bookCode:'PROVIDER-'+suffix,bookName:'Provider test book',functionalCurrency:'USD',accountingBasis:'IFRS',timezone:'UTC'});
    await periods.mapAccount(pool,tenantId,bookId,cash);
    await periods.mapAccount(pool,tenantId,bookId,liability);
    await periods.createPeriod(pool,tenantId,{periodId,bookId,periodCode:'2026-11-'+suffix,periodStart:'2026-11-01',periodEnd:'2026-11-30'});
    await periods.openPeriod(pool,tenantId,periodId);

    const journalId='provider-journal-'+suffix;
    const journal={journalId,idempotencyKey:'provider-ledger-'+suffix+'-000001',description:'Provider instruction funding',sourceRef:'test:provider:'+suffix,effectiveAt:'2026-11-10T10:00:00.000Z',bookId,periodId,accountingDate:'2026-11-10',lines:[
      {accountId:cash,side:'debit',currency:'USD',amountMinor:'500'},
      {accountId:liability,side:'credit',currency:'USD',amountMinor:'500'}
    ]};
    const grantorId=crypto.randomUUID(),principalId=crypto.randomUUID(),keyId='provider-agent-key-'+suffix,tokenHash=crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
    await admin.query("INSERT INTO keel_principals(principal_id,tenant_id,display_name,email,identity_assurance,principal_kind) VALUES($1,$2,'Provider grantor',$3,'externally_verified','human'),($4,$2,'Provider worker agent',$5,'externally_verified','ai_agent')",[grantorId,tenantId,grantorId+'@example.test',principalId,principalId+'@example.test']);
    await admin.query("INSERT INTO keel_tenant_keys(key_id,tenant_id,token_hash,label,role,principal_id) VALUES($1,$2,$3,'Provider lifecycle CI agent','integration',$4)",[keyId,tenantId,tokenHash,principalId]);
    const actor={tenant_id:tenantId,principal_id:principalId,key_id:keyId,role:'integration'};
    const envelope=authority.normalizeEnvelope({granteePrincipalId:principalId,scopes:['ledger:journal:post','provider:instruction:enqueue','provider:instruction:dispatch','provider:instruction:recover_expired','provider:instruction:outcome'],resourceIds:['book:'+bookId,'provider:bank-sandbox'],currency:'USD',maxAmountMinor:'1000',expiresAt:new Date(Date.now()+30*86400000).toISOString()},grantorId);
    const envelopeId=crypto.randomUUID(),envelopeFingerprint=authority.digest(envelope);
    await admin.query("INSERT INTO keel_authority_envelopes(tenant_id,envelope_id,grantor_principal_id,grantee_principal_id,scopes,resource_ids,currency,max_amount_minor,approval_required,approver_principal_id,valid_from,expires_at,envelope_fingerprint) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)",[tenantId,envelopeId,grantorId,principalId,JSON.stringify(envelope.scopes),JSON.stringify(envelope.resourceIds),envelope.currency,envelope.maxAmountMinor,false,null,envelope.validFrom,envelope.expiresAt,envelopeFingerprint]);
    const authorityContext={actor,envelopeId};
    const instruction={providerId:'bank-sandbox',aggregateType:'payment',aggregateId:'payment-'+suffix,instructionType:'payment.submit',idempotencyKey:'provider-outbox-'+suffix+'-0001',payload:{amountMinor:'500',currency:'USD',beneficiaryRef:'beneficiary-'+suffix}};
    const committed=await posting.postJournalAndEnqueueInstruction(pool,tenantId,journal,instruction,authorityContext);
    assert.equal(committed.journal.status,'posted');
    assert.equal(committed.outbox.replay,false);
    const outboxId=committed.outbox.outbox_id;
    const replay=await posting.postJournalAndEnqueueInstruction(pool,tenantId,journal,instruction,authorityContext);
    assert.equal(replay.journal.replay,true);
    assert.equal(replay.outbox.replay,true);
    assert.equal(replay.outbox.outbox_id,outboxId);

    const claimed=await lifecycle.claimNextInstruction(pool,tenantId,principalId,30,authorityContext);
    assert.equal(claimed.outbox_id,outboxId);
    assert.equal(claimed.attempts,1);
    const unknown=await lifecycle.recordDispatchOutcome(pool,tenantId,{outboxId,workerId:principalId,outcome:'unknown',errorCode:'provider_timeout'},authorityContext);
    assert.equal(unknown.status,'unknown');
    assert.equal(await lifecycle.claimNextInstruction(pool,tenantId,principalId,30,authorityContext),null,'unknown provider outcomes must not be automatically retried');

    const leaseJournal='provider-lease-journal-'+suffix;
    const leaseInstruction={providerId:'bank-sandbox',aggregateType:'payment',aggregateId:'lease-payment-'+suffix,instructionType:'payment.submit',idempotencyKey:'provider-lease-outbox-'+suffix+'-0001',payload:{amountMinor:'100',currency:'USD'}};
    const leaseCommit=await posting.postJournalAndEnqueueInstruction(pool,tenantId,{journalId:leaseJournal,idempotencyKey:'provider-lease-ledger-'+suffix+'-0001',description:'Provider lease test funding',sourceRef:'test:provider-lease:'+suffix,effectiveAt:'2026-11-10T10:00:00.000Z',bookId,periodId,accountingDate:'2026-11-10',lines:[{accountId:cash,side:'debit',currency:'USD',amountMinor:'100'},{accountId:liability,side:'credit',currency:'USD',amountMinor:'100'}]},leaseInstruction,authorityContext);
    const leasedId=leaseCommit.outbox.outbox_id;
    const lease=await lifecycle.claimNextInstruction(pool,tenantId,principalId,30,authorityContext);
    assert.equal(lease.outbox_id,leasedId);
    await lifecycle.withTenantTransaction(pool,tenantId,client=>client.query("UPDATE keel_provider_outbox SET lease_until=NOW()-INTERVAL '1 second' WHERE tenant_id=$1 AND outbox_id=$2",[tenantId,leasedId]));
    assert.equal(await lifecycle.claimNextInstruction(pool,tenantId,principalId,30,authorityContext),null);
    const expired=await lifecycle.withTenantTransaction(pool,tenantId,client=>client.query('SELECT status,last_error_code FROM keel_provider_outbox WHERE tenant_id=$1 AND outbox_id=$2',[tenantId,leasedId]));
    assert.equal(expired.rows[0].status,'unknown');
    assert.equal(expired.rows[0].last_error_code,'DISPATCH_LEASE_EXPIRED_OUTCOME_UNKNOWN');

    const secret='test-provider-webhook-secret-32-bytes-minimum',keyId='sandbox-signing-key';
    const adapter=new ProviderSandboxAdapter({providerId:'bank-sandbox',transport:createDeterministicSandboxTransport(),keyring:{[keyId]:secret},activeKeyId:keyId});
    const signedEvent={tenantId,providerId:'bank-sandbox',providerEventId:'evt-'+suffix,idempotencyKey:'provider-outbox-'+suffix+'-0001',eventType:'payment.status',status:'settled',occurredAt:'2026-11-10T10:01:00.000Z',payload:{amountMinor:'500',currency:'USD'}};
    const rawBody=JSON.stringify(signedEvent);
    const signature='sha256='+crypto.createHmac('sha256',secret).update(rawBody).digest('hex');
    const callback=await callbackIngress.ingestCallback({pool,adapter,rawBody,signature,keyId});
    assert.equal(callback.replay,false);
    assert.equal(callback.reconciliation.status,'matched');
    assert.equal(callback.reconciliation.execution,'DISABLED');
    const callbackReplay=await callbackIngress.ingestCallback({pool,adapter,rawBody,signature,keyId});
    assert.equal(callbackReplay.replay,true);
    assert.equal(callbackReplay.inboxId,callback.inboxId);
    const outboxState=await lifecycle.withTenantTransaction(pool,tenantId,client=>client.query('SELECT status FROM keel_provider_outbox WHERE tenant_id=$1 AND outbox_id=$2',[tenantId,outboxId]));
    assert.equal(outboxState.rows[0].status,'reconciled');

    const unscoped=await pool.query('SELECT inbox_id FROM keel_provider_inbox WHERE tenant_id=$1',[tenantId]);
    assert.equal(unscoped.rowCount,0,'provider inbox must be invisible without transaction-local tenant context');
    const own=await lifecycle.withTenantTransaction(pool,tenantId,client=>client.query('SELECT inbox_id FROM keel_provider_inbox WHERE tenant_id=$1',[tenantId]));
    assert.equal(own.rowCount,1);
    const cases=await lifecycle.withTenantTransaction(pool,tenantId,client=>client.query('SELECT status FROM keel_provider_reconciliation_cases WHERE tenant_id=$1',[tenantId]));
    assert.equal(cases.rows[0].status,'matched');
    const chain=await posting.verifyLedgerEventChain(pool,tenantId);assert.equal(chain.valid,true);
  }finally{
    await pool.end();
    await admin.end();
  }
});
