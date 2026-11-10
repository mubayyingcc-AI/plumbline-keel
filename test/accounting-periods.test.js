'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const periods=require('../src/accounting-periods');

test('accounting book validates currency, accounting basis and timezone',()=>{
  const book=periods.validateBook({bookId:'book-001',entityId:'entity-001',bookCode:'GENERAL',bookName:'General Ledger',functionalCurrency:'usd',accountingBasis:'IFRS',timezone:'Africa/Lagos'});
  assert.equal(book.functionalCurrency,'USD');
  assert.equal(book.timezone,'Africa/Lagos');
  assert.throws(()=>periods.validateBook({bookId:'book-001',entityId:'entity-001',bookCode:'GENERAL',bookName:'General Ledger',functionalCurrency:'US',accountingBasis:'IFRS'}),/accounting_book_identity_invalid/);
  assert.throws(()=>periods.validateBook({bookId:'book-001',entityId:'entity-001',bookCode:'GENERAL',bookName:'General Ledger',functionalCurrency:'USD',accountingBasis:'UNKNOWN'}),/accounting_basis_invalid/);
  assert.throws(()=>periods.validateBook({bookId:'book-001',entityId:'entity-001',bookCode:'GENERAL',bookName:'General Ledger',functionalCurrency:'USD',accountingBasis:'IFRS',timezone:'Mars/Olympus'}),/accounting_timezone_invalid/);
});

test('accounting periods reject impossible dates and reversed ranges',()=>{
  assert.throws(()=>periods.validatePeriod({periodId:'p-1',bookId:'b-1',periodCode:'2026-02',periodStart:'2026-02-30',periodEnd:'2026-02-28'}),/invalid_calendar_date/);
  assert.throws(()=>periods.validatePeriod({periodId:'p-1',bookId:'b-1',periodCode:'2026-03',periodStart:'2026-03-31',periodEnd:'2026-03-01'}),/date_range_invalid/);
  const p=periods.validatePeriod({periodId:'p-1',bookId:'b-1',periodCode:'2026-11',periodStart:'2026-11-01',periodEnd:'2026-11-30'});
  assert.equal(p.periodStart,'2026-11-01');
});

test('trial balance uses exact integer minor units and balances separately by currency',()=>{
  const result=periods.calculateTrialBalance([
    {account_id:'cash',account_code:'1000',account_name:'Cash',account_class:'asset',currency:'USD',normal_side:'debit',opening_debit_minor:'10000000000000000001',opening_credit_minor:'1',period_debit_minor:'300',period_credit_minor:'100'},
    {account_id:'payables',account_code:'2000',account_name:'Payables',account_class:'liability',currency:'USD',normal_side:'credit',opening_debit_minor:'0',opening_credit_minor:'10000000000000000000',period_debit_minor:'100',period_credit_minor:'300'},
    {account_id:'cash-ngn',account_code:'1001',account_name:'Cash NGN',account_class:'asset',currency:'NGN',normal_side:'debit',opening_debit_minor:'500',opening_credit_minor:'0',period_debit_minor:'25',period_credit_minor:'5'},
    {account_id:'equity-ngn',account_code:'3001',account_name:'Equity NGN',account_class:'equity',currency:'NGN',normal_side:'credit',opening_debit_minor:'0',opening_credit_minor:'500',period_debit_minor:'5',period_credit_minor:'25'}
  ],{periodId:'p-1',periodCode:'2026-11'});
  assert.equal(result.status,'BALANCED');
  assert.equal(result.totalsByCurrency.USD.periodDebitsMinor,'400');
  assert.equal(result.totalsByCurrency.USD.periodCreditsMinor,'400');
  assert.equal(result.accounts.find(x=>x.accountId==='cash').openingBalanceMinor,'10000000000000000000');
  assert.equal(result.accounts.find(x=>x.accountId==='cash').closingBalanceMinor,'10000000000000000200');
  assert.equal(result.totalsByCurrency.NGN.closingBalanced,true);
});

test('trial balance flags imbalance instead of silently netting currencies',()=>{
  const result=periods.calculateTrialBalance([
    {account_id:'cash-usd',account_code:'1000',account_name:'Cash USD',account_class:'asset',currency:'USD',normal_side:'debit',opening_debit_minor:'0',opening_credit_minor:'0',period_debit_minor:'100',period_credit_minor:'0'},
    {account_id:'cash-ngn',account_code:'1001',account_name:'Cash NGN',account_class:'asset',currency:'NGN',normal_side:'debit',opening_debit_minor:'0',opening_credit_minor:'0',period_debit_minor:'0',period_credit_minor:'100'}
  ],{periodId:'p-2'});
  assert.equal(result.status,'OUT_OF_BALANCE');
  assert.equal(result.totalsByCurrency.USD.periodBalanced,false);
  assert.equal(result.totalsByCurrency.NGN.periodBalanced,false);
});
