'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const url=process.env.KEEL_LEDGER_TEST_DATABASE_URL;
const posting=require('../src/ledger-posting');
const ledger=require('../src/ledger-engine');

test('PostgreSQL ledger posting, idempotency, holds and concurrency', {skip:!url && 'Set KEEL_LEDGER_TEST_DATABASE_URL to a disposable PostgreSQL database with migrations 012 and 013 applied'}, async()=>{
  const {Pool}=require('pg');
  const pool=new Pool({connectionString:url,max:8});
  const tenantId=crypto.randomUUID();
  const suffix=crypto.randomUUID().replace(/-/g,'').slice(0,12);
  try {
    await pool.query("INSERT INTO keel_tenants(tenant_id,tenant_name,tenant_slug,status) VALUES($1,$2,$3,'active')",[tenantId,'Keel ledger integration '+suffix,'ledger-test-'+suffix]);
    await posting.createAccount(pool,tenantId,{accountId:'cash-'+suffix,accountCode:'1000-'+suffix,accountName:'Cash asset',accountClass:'asset',currency:'USD',currencyExponent:2,normalSide:'debit'});
    await posting.createAccount(pool,tenantId,{accountId:'customer-liability-'+suffix,accountCode:'2000-'+suffix,accountName:'Customer funds liability',accountClass:'liability',currency:'USD',currencyExponent:2,normalSide:'credit',isReservable:true});
    await assert.rejects(()=>posting.createAccount(pool,tenantId,{accountId:'bad-scale-'+suffix,accountCode:'9000-'+suffix,accountName:'Invalid scale',accountClass:'asset',currency:'USD',currencyExponent:7,normalSide:'debit'}),/ledger_account_currency_exponent_invalid/);
    assert.equal((await posting.listAccounts(pool,tenantId)).every(a=>a.currencyExponent===2),true);
    const cash='cash-'+suffix,liability='customer-liability-'+suffix;
    const funding={journalId:'fund-'+suffix,idempotencyKey:'funding-key-'+suffix+'-000000',description:'Integration funding',sourceRef:'test:funding:'+suffix,effectiveAt:new Date().toISOString(),lines:[
      {accountId:cash,side:'debit',currency:'USD',amountMinor:'1000'},
      {accountId:liability,side:'credit',currency:'USD',amountMinor:'1000'}
    ]};
    const first=await posting.postJournal(pool,tenantId,funding);
    assert.equal(first.status,'posted');
    assert.equal((await posting.postJournal(pool,tenantId,funding)).replay,true);
    await assert.rejects(()=>posting.postJournal(pool,tenantId,{...funding,lines:[
      {accountId:cash,side:'debit',currency:'USD',amountMinor:'999'},
      {accountId:liability,side:'credit',currency:'USD',amountMinor:'999'}
    ]}),/ledger_idempotency_conflict/);

    const attempts=await Promise.allSettled([
      posting.createReservation(pool,tenantId,{reservationId:'hold-a-'+suffix,idempotencyKey:'reserve-a-'+suffix+'-000000',accountId:liability,amountMinor:'700',purpose:'Concurrent spend test'}),
      posting.createReservation(pool,tenantId,{reservationId:'hold-b-'+suffix,idempotencyKey:'reserve-b-'+suffix+'-000000',accountId:liability,amountMinor:'700',purpose:'Concurrent spend test'})
    ]);
    assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(attempts.filter(x=>x.status==='rejected').length,1);
    const hold=attempts.find(x=>x.status==='fulfilled').value.reservationId;

    const before=await posting.getAccountBalance(pool,tenantId,liability);
    assert.equal(before.ledgerBalanceMinor,'1000');
    assert.equal(before.reservedMinor,'700');
    assert.equal(before.availableMinor,'300');

    await assert.rejects(()=>posting.postJournal(pool,tenantId,{journalId:'overdraw-'+suffix,idempotencyKey:'overdraw-key-'+suffix+'-000000',description:'Must not breach reservation',sourceRef:'test:overdraw:'+suffix,effectiveAt:new Date().toISOString(),lines:[
      {accountId:liability,side:'debit',currency:'USD',amountMinor:'301'},
      {accountId:cash,side:'credit',currency:'USD',amountMinor:'301'}
    ]}),/ledger_posting_would_breach_active_reservations/);

    const spend={journalId:'spend-'+suffix,idempotencyKey:'spend-key-'+suffix+'-000000',description:'Consume reserved funds',sourceRef:'test:spend:'+suffix,effectiveAt:new Date().toISOString(),lines:[
      {accountId:liability,side:'debit',currency:'USD',amountMinor:'700'},
      {accountId:cash,side:'credit',currency:'USD',amountMinor:'700'}
    ]};
    const consumed=await posting.consumeReservation(pool,tenantId,hold,spend);
    assert.equal(consumed.status,'consumed');
    const after=await posting.getAccountBalance(pool,tenantId,liability);
    assert.equal(after.ledgerBalanceMinor,'300');
    assert.equal(after.reservedMinor,'0');
    assert.equal(after.availableMinor,'300');

    assert.equal((await posting.verifyAccountProjection(pool,tenantId,liability)).matches,true);

    const reversalCash='reversal-cash-'+suffix, reversalEquity='reversal-equity-'+suffix;
    await posting.createAccount(pool,tenantId,{accountId:reversalCash,accountCode:'3000-'+suffix,accountName:'Reversal test cash',accountClass:'asset',currency:'USD',currencyExponent:2,normalSide:'debit'});
    await posting.createAccount(pool,tenantId,{accountId:reversalEquity,accountCode:'4000-'+suffix,accountName:'Reversal test equity',accountClass:'equity',currency:'USD',currencyExponent:2,normalSide:'credit'});
    const original={tenantId,journalId:'original-'+suffix,idempotencyKey:'original-key-'+suffix+'-000000',description:'Original journal for reversal',sourceRef:'test:reversal:'+suffix,effectiveAt:new Date().toISOString(),lines:[
      {accountId:reversalCash,side:'debit',currency:'USD',amountMinor:'50'},
      {accountId:reversalEquity,side:'credit',currency:'USD',amountMinor:'50'}
    ]};
    await posting.postJournal(pool,tenantId,original);
    const reversal=ledger.buildReversal({original,tenantId,journalId:'reversal-'+suffix,idempotencyKey:'reversal-key-'+suffix+'-000000',effectiveAt:new Date().toISOString()});
    await posting.postJournal(pool,tenantId,reversal);
    assert.equal((await posting.getAccountBalance(pool,tenantId,reversalCash)).ledgerBalanceMinor,'0');
    assert.equal((await posting.getAccountBalance(pool,tenantId,reversalEquity)).ledgerBalanceMinor,'0');
    await assert.rejects(()=>posting.postJournal(pool,tenantId,{...reversal,journalId:'second-reversal-'+suffix,idempotencyKey:'second-reversal-key-'+suffix+'-000000'}));
    const forged={...reversal,journalId:'forged-reversal-'+suffix,idempotencyKey:'forged-reversal-key-'+suffix+'-000000',lines:[
      {accountId:reversalCash,side:'credit',currency:'USD',amountMinor:'49'},
      {accountId:reversalEquity,side:'debit',currency:'USD',amountMinor:'49'}
    ]};
    await assert.rejects(()=>posting.postJournal(pool,tenantId,forged),/ledger_reversal_must_exactly_reverse_original/);
    const chainCheck=await posting.verifyLedgerEventChain(pool,tenantId);
    if(!chainCheck.valid)throw new Error('ledger_chain_check:'+JSON.stringify(chainCheck));
  } finally {
    await pool.end();
  }
});
