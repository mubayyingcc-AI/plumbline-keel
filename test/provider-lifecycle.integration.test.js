'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const url=process.env.KEEL_LEDGER_TEST_DATABASE_URL;
const posting=require('../src/ledger-posting');
const lifecycle=require('../src/provider-lifecycle');
const periods=require('../src/accounting-periods');

test('provider outbox/inbox is tenant-bound, durable, idempotent and never auto-posts settlement',{skip:!url&&'Set KEEL_LEDGER_TEST_DATABASE_URL to disposable PostgreSQL with migrations 012-017 applied'},async()=>{
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
    const instruction={providerId:'bank-sandbox',aggregateType:'payment',aggregateId:'payment-'+suffix,instructionType:'payment.submit',idempotencyKey:'provider-outbox-'+suffix+'-0001',payload:{amountMinor:'500',currency:'USD',beneficiaryRef:'beneficiary-'+suffix}};
    const committed=await posting.postJournalAndEnqueueInstruction(pool,tenantId,journal,instruction);
    assert.equal(committed.journal.status,'posted');
    assert.equal(committed.outbox.replay,false);
    const outboxId=committed.outbox.outbox_id;
    const replay=await posting.postJournalAndEnqueueInstruction(pool,tenantId,journal,instruction);
    assert.equal(replay.journal.replay,true);
    assert.equal(replay.outbox.replay,true);
    assert.equal(replay.outbox.outbox_id,outboxId);

    const claimed=await lifecycle.claimNextInstruction(pool,tenantId,'worker-'+suffix,30);
    assert.equal(claimed.outbox_id,outboxId);
    assert.equal(claimed.attempts,1);
    const unknown=await lifecycle.recordDispatchOutcome(pool,tenantId,{outboxId,workerId:'worker-'+suffix,outcome:'unknown',errorCode:'provider_timeout'});
    assert.equal(unknown.status,'unknown');
    assert.equal(await lifecycle.claimNextInstruction(pool,tenantId,'worker-retry-'+suffix,30),null,'unknown provider outcomes must not be automatically retried');

    const leaseJournal='provider-lease-journal-'+suffix;
    await posting.postJournal(pool,tenantId,{journalId:leaseJournal,idempotencyKey:'provider-lease-ledger-'+suffix+'-0001',description:'Provider lease test funding',sourceRef:'test:provider-lease:'+suffix,effectiveAt:'2026-11-10T10:00:00.000Z',bookId,periodId,accountingDate:'2026-11-10',lines:[
      {accountId:cash,side:'debit',currency:'USD',amountMinor:'100'},
      {accountId:liability,side:'credit',currency:'USD',amountMinor:'100'}
    ]});
    const leaseClient=await pool.connect();
    let leasedId;
    try{
      await leaseClient.query('BEGIN');
      await leaseClient.query("SELECT set_config('keel.tenant_id',$1,true)",[tenantId]);
      const q=await lifecycle.enqueueInstruction(leaseClient,{tenantId,journalId:leaseJournal,providerId:'bank-sandbox',aggregateType:'payment',aggregateId:'lease-payment-'+suffix,instructionType:'payment.submit',idempotencyKey:'provider-lease-outbox-'+suffix+'-0001',payload:{amountMinor:'100',currency:'USD'}});
      leasedId=q.outbox_id;
      await leaseClient.query('COMMIT');
    }catch(e){await leaseClient.query('ROLLBACK');throw e;}finally{leaseClient.release();}
    const lease=await lifecycle.claimNextInstruction(pool,tenantId,'crashed-worker-'+suffix,30);
    assert.equal(lease.outbox_id,leasedId);
    await lifecycle.withTenantTransaction(pool,tenantId,client=>client.query("UPDATE keel_provider_outbox SET lease_until=NOW()-INTERVAL '1 second' WHERE tenant_id=$1 AND outbox_id=$2",[tenantId,leasedId]));
    assert.equal(await lifecycle.claimNextInstruction(pool,tenantId,'must-not-redispatch-'+suffix,30),null);
    const expired=await lifecycle.withTenantTransaction(pool,tenantId,client=>client.query('SELECT status,last_error_code FROM keel_provider_outbox WHERE tenant_id=$1 AND outbox_id=$2',[tenantId,leasedId]));
    assert.equal(expired.rows[0].status,'unknown');
    assert.equal(expired.rows[0].last_error_code,'DISPATCH_LEASE_EXPIRED_OUTCOME_UNKNOWN');

    const eventClient=await pool.connect();
    let inboxId;
    try{
      await eventClient.query('BEGIN');
      await eventClient.query("SELECT set_config('keel.tenant_id',$1,true)",[tenantId]);
      const signedEvent={providerEventId:'evt-'+suffix,idempotencyKey:'provider-outbox-'+suffix+'-0001',eventType:'payment.status',status:'settled',occurredAt:'2026-11-10T10:01:00.000Z',payload:{amountMinor:'500',currency:'USD'}};
      const rawBody=JSON.stringify(signedEvent);
      const secret='test-provider-webhook-secret-32-bytes-minimum';
      const signature='sha256='+crypto.createHmac('sha256',secret).update(rawBody).digest('hex');
      const verification=lifecycle.verifyHmacSha256({rawBody,signature,secret,keyId:'sandbox-signing-key'});
      const event=await lifecycle.recordVerifiedProviderEvent(eventClient,{
        tenantId,providerId:'bank-sandbox',providerEventId:signedEvent.providerEventId,idempotencyKey:signedEvent.idempotencyKey,
        eventType:signedEvent.eventType,status:signedEvent.status,occurredAt:signedEvent.occurredAt,
        payload:signedEvent.payload,rawBody,verification
      });
      inboxId=event.inbox_id;
      const replay=await lifecycle.recordVerifiedProviderEvent(eventClient,{
        tenantId,providerId:'bank-sandbox',providerEventId:signedEvent.providerEventId,idempotencyKey:signedEvent.idempotencyKey,
        eventType:signedEvent.eventType,status:signedEvent.status,occurredAt:signedEvent.occurredAt,
        payload:{currency:'USD',amountMinor:'500'},rawBody,verification
      });
      assert.equal(replay.replay,true);
      assert.equal(replay.inbox_id,inboxId);
      const reconciliation=await lifecycle.reconcileProviderEvent(eventClient,tenantId,inboxId);
      assert.equal(reconciliation.status,'matched');
      assert.equal(reconciliation.execution,'DISABLED');
      const outboxState=await eventClient.query('SELECT status FROM keel_provider_outbox WHERE tenant_id=$1 AND outbox_id=$2',[tenantId,outboxId]);
      assert.equal(outboxState.rows[0].status,'reconciled');
      await eventClient.query('COMMIT');
    }catch(e){await eventClient.query('ROLLBACK');throw e;}finally{eventClient.release();}

    const unscoped=await pool.query('SELECT inbox_id FROM keel_provider_inbox WHERE tenant_id=$1',[tenantId]);
    assert.equal(unscoped.rowCount,0,'provider inbox must be invisible without transaction-local tenant context');
    const own=await lifecycle.withTenantTransaction(pool,tenantId,client=>client.query('SELECT inbox_id FROM keel_provider_inbox WHERE tenant_id=$1',[tenantId]));
    assert.equal(own.rowCount,1);
    const cases=await lifecycle.withTenantTransaction(pool,tenantId,client=>client.query('SELECT status FROM keel_provider_reconciliation_cases WHERE tenant_id=$1',[tenantId]));
    assert.equal(cases.rows[0].status,'matched');
  }finally{
    await pool.end();
    await admin.end();
  }
});
