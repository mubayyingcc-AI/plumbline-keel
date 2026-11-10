'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const ledger=require('../src/ledger-engine');
const base=()=>({tenantId:'tenant-a',journalId:'j-001',idempotencyKey:'idempotency-key-0001',description:'Customer funding receipt',sourceRef:'bank-statement:line-42',effectiveAt:'2026-11-09T10:00:00Z',lines:[
 {accountId:'customer-cash',side:'debit',currency:'USD',amountMinor:'12500'},
 {accountId:'customer-liability',side:'credit',currency:'USD',amountMinor:'12500'}
]});
test('validates a balanced single-currency journal using exact integer units',()=>{
 const j=ledger.buildJournal(base());assert.equal(j.status,'validated_not_posted');assert.equal(j.totalsByCurrency.USD,'12500');assert.equal(j.lineCount,2);assert.match(j.fingerprint,/^[a-f0-9]{64}$/);
});
test('rejects unbalanced debit and credit totals',()=>{
 const j=base();j.lines[1].amountMinor='12499';assert.throws(()=>ledger.buildJournal(j),/journal_unbalanced:USD/);
});
test('balances each currency independently in a multi-currency journal',()=>{
 const j=base();j.lines.push({accountId:'fx-clearing-eur',side:'debit',currency:'EUR',amountMinor:'10000'},{accountId:'fx-position-eur',side:'credit',currency:'EUR',amountMinor:'10000'});
 assert.deepEqual(ledger.buildJournal(j).totalsByCurrency,{USD:'12500',EUR:'10000'});
});
test('rejects invalid precision, floating point and zero amounts',()=>{
 for(const amount of ['1.25',1,0,'0','-1','01','1e3']){const j=base();j.lines[0].amountMinor=amount;assert.throws(()=>ledger.buildJournal(j));}
});
test('requires distinct accounts and at least two lines',()=>{
 const j=base();j.lines[1].accountId=j.lines[0].accountId;assert.throws(()=>ledger.buildJournal(j),/distinct_accounts/);
 const k=base();k.lines=k.lines.slice(0,1);assert.throws(()=>ledger.buildJournal(k),/lines_count/);
});
test('reversal is a compensating journal and does not mutate original',()=>{
 const original=base(),before=structuredClone(original);
 const reversal=ledger.buildReversal({original,tenantId:'tenant-a',journalId:'j-002',idempotencyKey:'idempotency-key-0002',effectiveAt:'2026-11-09T11:00:00Z'});
 assert.equal(reversal.lines[0].side,'credit');assert.equal(reversal.lines[1].side,'debit');assert.equal(reversal.reversalOfJournalId,'j-001');assert.deepEqual(original,before);
});
test('prevents cross-tenant reversal',()=>{
 assert.throws(()=>ledger.buildReversal({original:base(),tenantId:'tenant-b',journalId:'j-002',idempotencyKey:'idempotency-key-0002',effectiveAt:'2026-11-09T11:00:00Z'}),/tenant_mismatch/);
});
test('idempotent replay must match the exact journal fingerprint',()=>{
 const j=base();assert.equal(ledger.assertSameJournal(j,structuredClone(j)),true);
 const changed=base();changed.lines[0].amountMinor='12501';changed.lines[1].amountMinor='12501';assert.equal(ledger.assertSameJournal(j,changed),false);
});

test('period-bound journal identity is fingerprinted and accounting date is strict',()=>{
  const journal=ledger.buildJournal({...base(),bookId:'book-1',periodId:'period-1'});
  assert.equal(journal.bookId,'book-1');
  assert.equal(journal.periodId,'period-1');
  assert.equal(journal.accountingDate,'2026-11-09');
  assert.throws(()=>ledger.buildJournal({...base(),bookId:'book-1'}),/must_be_bound_together/);
  assert.throws(()=>ledger.buildJournal({...base(),periodId:'period-1'}),/must_be_bound_together/);
  assert.throws(()=>ledger.buildJournal({...base(),bookId:'book-1',periodId:'period-1',accountingDate:'2026-02-31'}),/invalid_calendar_date/);
});
