'use strict';

const { withTransaction } = require('./ledger-posting');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const BASES=new Set(['IFRS','LOCAL_GAAP','IPSAS','INTERNAL']);

function fail(code,status=400){const error=new Error(code);error.status=status;throw error;}
function tenantId(value){if(typeof value!=='string'||!UUID.test(value))fail('tenant_id_invalid');return value;}
function required(value,name,max=120){if(typeof value!=='string'||!value.trim()||value.length>max)fail(name+'_required');return value.trim();}
function dateOnly(value,name){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail(name+'_must_be_iso_date');
  const date=new Date(value+'T00:00:00.000Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)fail(name+'_invalid_calendar_date');
  return value;
}
function validateBook(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('accounting_book_required');
  const book={
    bookId:required(input.bookId,'book_id'),
    entityId:required(input.entityId,'entity_id'),
    bookCode:required(input.bookCode,'book_code',64),
    bookName:required(input.bookName,'book_name',180),
    functionalCurrency:required(input.functionalCurrency,'functional_currency',3).toUpperCase(),
    accountingBasis:required(input.accountingBasis,'accounting_basis',24),
    timezone:input.timezone==null?'UTC':required(input.timezone,'timezone',80)
  };
  if(!ID.test(book.bookId)||!ID.test(book.entityId)||!/^[A-Z]{3}$/.test(book.functionalCurrency))fail('accounting_book_identity_invalid');
  if(!BASES.has(book.accountingBasis))fail('accounting_basis_invalid');
  try{new Intl.DateTimeFormat('en-US',{timeZone:book.timezone});}catch(_){fail('accounting_timezone_invalid');}
  return book;
}
function validatePeriod(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('accounting_period_required');
  const period={
    periodId:required(input.periodId,'period_id'),
    bookId:required(input.bookId,'book_id'),
    periodCode:required(input.periodCode,'period_code',64),
    periodStart:dateOnly(input.periodStart,'period_start'),
    periodEnd:dateOnly(input.periodEnd,'period_end')
  };
  if(!ID.test(period.periodId)||!ID.test(period.bookId)||!ID.test(period.periodCode))fail('accounting_period_identity_invalid');
  if(period.periodStart>period.periodEnd)fail('accounting_period_date_range_invalid');
  return period;
}
function calculateTrialBalance(rows,period){
  const totals=new Map(),accounts=[];
  for(const row of rows){
    const openingDebit=BigInt(row.opening_debit_minor||'0');
    const openingCredit=BigInt(row.opening_credit_minor||'0');
    const periodDebit=BigInt(row.period_debit_minor||'0');
    const periodCredit=BigInt(row.period_credit_minor||'0');
    const debitNormal=row.normal_side==='debit';
    const openingBalance=debitNormal?openingDebit-openingCredit:openingCredit-openingDebit;
    const periodMovement=debitNormal?periodDebit-periodCredit:periodCredit-periodDebit;
    const closingBalance=openingBalance+periodMovement;
    const item={
      accountId:row.account_id,accountCode:row.account_code,accountName:row.account_name,
      accountClass:row.account_class,currency:row.currency,normalSide:row.normal_side,
      openingDebitMinor:openingDebit.toString(),openingCreditMinor:openingCredit.toString(),
      openingBalanceMinor:openingBalance.toString(),periodDebitMinor:periodDebit.toString(),
      periodCreditMinor:periodCredit.toString(),periodMovementMinor:periodMovement.toString(),
      closingBalanceMinor:closingBalance.toString()
    };
    accounts.push(item);
    const t=totals.get(row.currency)||{openingDebits:0n,openingCredits:0n,periodDebits:0n,periodCredits:0n,closingDebits:0n,closingCredits:0n};
    t.openingDebits+=openingDebit;t.openingCredits+=openingCredit;
    t.periodDebits+=periodDebit;t.periodCredits+=periodCredit;
    if(debitNormal){if(closingBalance>=0n)t.closingDebits+=closingBalance;else t.closingCredits+=-closingBalance;}
    else{if(closingBalance>=0n)t.closingCredits+=closingBalance;else t.closingDebits+=-closingBalance;}
    totals.set(row.currency,t);
  }
  const totalsByCurrency={};
  let balanced=true;
  for(const [currency,t] of totals){
    const item={
      openingDebitsMinor:t.openingDebits.toString(),openingCreditsMinor:t.openingCredits.toString(),
      periodDebitsMinor:t.periodDebits.toString(),periodCreditsMinor:t.periodCredits.toString(),
      closingDebitsMinor:t.closingDebits.toString(),closingCreditsMinor:t.closingCredits.toString(),
      openingBalanced:t.openingDebits===t.openingCredits,
      periodBalanced:t.periodDebits===t.periodCredits,
      closingBalanced:t.closingDebits===t.closingCredits
    };
    if(!item.openingBalanced||!item.periodBalanced||!item.closingBalanced)balanced=false;
    totalsByCurrency[currency]=item;
  }
  return {status:balanced?'BALANCED':'OUT_OF_BALANCE',balanced,period,accountCount:accounts.length,accounts,totalsByCurrency};
}
async function createBook(pool,tenantInput,input){
  const tenant=tenantId(tenantInput),book=validateBook(input);
  return withTransaction(pool,async client=>{
    await client.query('INSERT INTO keel_accounting_books(tenant_id,book_id,entity_id,book_code,book_name,functional_currency,accounting_basis,timezone) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [tenant,book.bookId,book.entityId,book.bookCode,book.bookName,book.functionalCurrency,book.accountingBasis,book.timezone]);
    return {...book,status:'active'};
  },tenant);
}
async function listBooks(pool,tenantInput){
  const tenant=tenantId(tenantInput);
  return withTransaction(pool,async client=>{
    const r=await client.query('SELECT book_id,entity_id,book_code,book_name,functional_currency,accounting_basis,timezone,status,created_at FROM keel_accounting_books WHERE tenant_id=$1 ORDER BY book_code',[tenant]);
    return r.rows;
  },tenant);
}
async function mapAccount(pool,tenantInput,bookIdInput,accountIdInput){
  const tenant=tenantId(tenantInput),bookId=required(bookIdInput,'book_id'),accountId=required(accountIdInput,'account_id');
  return withTransaction(pool,async client=>{
    const book=await client.query("SELECT status FROM keel_accounting_books WHERE tenant_id=$1 AND book_id=$2 FOR UPDATE",[tenant,bookId]);
    if(!book.rowCount||book.rows[0].status!=='active')fail('accounting_book_not_active',409);
    const account=await client.query("SELECT status FROM keel_ledger_accounts WHERE tenant_id=$1 AND account_id=$2 FOR KEY SHARE",[tenant,accountId]);
    if(!account.rowCount||account.rows[0].status!=='active')fail('ledger_account_not_active',409);
    await client.query("INSERT INTO keel_accounting_book_accounts(tenant_id,book_id,account_id) VALUES($1,$2,$3)",[tenant,bookId,accountId]);
    return {bookId,accountId,status:'active'};
  },tenant);
}
async function listBookAccounts(pool,tenantInput,bookIdInput){
  const tenant=tenantId(tenantInput),bookId=required(bookIdInput,'book_id');
  return withTransaction(pool,async client=>{
    const r=await client.query('SELECT a.account_id,a.account_code,a.account_name,a.account_class,a.currency,a.currency_exponent,a.normal_side,ba.status,ba.mapped_at FROM keel_accounting_book_accounts ba JOIN keel_ledger_accounts a ON a.tenant_id=ba.tenant_id AND a.account_id=ba.account_id WHERE ba.tenant_id=$1 AND ba.book_id=$2 ORDER BY a.account_code,a.currency',[tenant,bookId]);
    return r.rows;
  },tenant);
}
async function createPeriod(pool,tenantInput,input){
  const tenant=tenantId(tenantInput),period=validatePeriod(input);
  return withTransaction(pool,async client=>{
    const book=await client.query("SELECT status FROM keel_accounting_books WHERE tenant_id=$1 AND book_id=$2 FOR UPDATE",[tenant,period.bookId]);
    if(!book.rowCount||book.rows[0].status!=='active')fail('accounting_book_not_active',409);
    const overlap=await client.query('SELECT period_id FROM keel_accounting_periods WHERE tenant_id=$1 AND book_id=$2 AND period_start<=$4::date AND period_end>=$3::date LIMIT 1',[tenant,period.bookId,period.periodStart,period.periodEnd]);
    if(overlap.rowCount)fail('accounting_period_overlaps_existing_period',409);
    await client.query("INSERT INTO keel_accounting_periods(tenant_id,period_id,book_id,period_code,period_start,period_end,status) VALUES($1,$2,$3,$4,$5::date,$6::date,'planned')",
      [tenant,period.periodId,period.bookId,period.periodCode,period.periodStart,period.periodEnd]);
    return {...period,status:'planned'};
  },tenant);
}
async function listPeriods(pool,tenantInput,bookIdInput){
  const tenant=tenantId(tenantInput),bookId=bookIdInput==null?null:required(bookIdInput,'book_id');
  return withTransaction(pool,async client=>{
    const r=await client.query('SELECT period_id,book_id,period_code,period_start,period_end,status,created_at,opened_at,closed_at,closed_by,close_hash,version FROM keel_accounting_periods WHERE tenant_id=$1 AND ($2::text IS NULL OR book_id=$2) ORDER BY period_start,period_code',[tenant,bookId]);
    return r.rows;
  },tenant);
}
async function openPeriod(pool,tenantInput,periodIdInput){
  const tenant=tenantId(tenantInput),periodIdValue=required(periodIdInput,'period_id');
  return withTransaction(pool,async client=>{
    const r=await client.query('SELECT period_id,book_id,status FROM keel_accounting_periods WHERE tenant_id=$1 AND period_id=$2 FOR UPDATE',[tenant,periodIdValue]);
    if(!r.rowCount)fail('accounting_period_not_found',404);
    if(r.rows[0].status!=='planned')fail('accounting_period_must_be_planned_to_open',409);
    await client.query("UPDATE keel_accounting_periods SET status='open',opened_at=NOW() WHERE tenant_id=$1 AND period_id=$2",[tenant,periodIdValue]);
    return {periodId:periodIdValue,bookId:r.rows[0].book_id,status:'open'};
  },tenant);
}
async function trialBalance(pool,tenantInput,bookIdInput,periodIdInput){
  const tenant=tenantId(tenantInput),bookId=required(bookIdInput,'book_id'),periodIdValue=required(periodIdInput,'period_id');
  return withTransaction(pool,async client=>{
    const p=await client.query('SELECT p.period_id,p.period_code,p.period_start,p.period_end,p.status,b.book_id,b.book_code,b.book_name,b.functional_currency,b.accounting_basis,b.timezone FROM keel_accounting_periods p JOIN keel_accounting_books b ON b.tenant_id=p.tenant_id AND b.book_id=p.book_id WHERE p.tenant_id=$1 AND p.book_id=$2 AND p.period_id=$3',[tenant,bookId,periodIdValue]);
    if(!p.rowCount)fail('accounting_period_not_found',404);
    const period=p.rows[0];
    const rows=await client.query(
      "SELECT a.account_id,a.account_code,a.account_name,a.account_class,a.currency,a.normal_side, COALESCE(SUM(l.amount_minor) FILTER(WHERE j.accounting_date<$3::date AND l.side='debit'),0)::text AS opening_debit_minor, COALESCE(SUM(l.amount_minor) FILTER(WHERE j.accounting_date<$3::date AND l.side='credit'),0)::text AS opening_credit_minor, COALESCE(SUM(l.amount_minor) FILTER(WHERE j.accounting_date BETWEEN $3::date AND $4::date AND l.side='debit'),0)::text AS period_debit_minor, COALESCE(SUM(l.amount_minor) FILTER(WHERE j.accounting_date BETWEEN $3::date AND $4::date AND l.side='credit'),0)::text AS period_credit_minor FROM keel_accounting_book_accounts ba JOIN keel_ledger_accounts a ON a.tenant_id=ba.tenant_id AND a.account_id=ba.account_id LEFT JOIN keel_ledger_lines l ON l.tenant_id=a.tenant_id AND l.account_id=a.account_id LEFT JOIN keel_ledger_journals j ON j.tenant_id=l.tenant_id AND j.journal_id=l.journal_id AND j.status='posted' AND j.book_id=$2 AND j.accounting_date<=$4::date WHERE ba.tenant_id=$1 AND ba.book_id=$2 AND ba.status='active' AND a.status='active' GROUP BY a.account_id,a.account_code,a.account_name,a.account_class,a.currency,a.normal_side ORDER BY a.account_code,a.currency",
      [tenant,bookId,period.period_start,period.period_end]
    );
    return {book:{bookId:period.book_id,bookCode:period.book_code,bookName:period.book_name,functionalCurrency:period.functional_currency,accountingBasis:period.accounting_basis,timezone:period.timezone},period:{periodId:period.period_id,periodCode:period.period_code,start:period.period_start,end:period.period_end,status:period.status},...calculateTrialBalance(rows.rows,{periodId:period.period_id,periodCode:period.period_code,start:period.period_start,end:period.period_end,status:period.status})};
  },tenant);
}

module.exports={validateBook,validatePeriod,calculateTrialBalance,createBook,listBooks,mapAccount,listBookAccounts,createPeriod,listPeriods,openPeriod,trialBalance};
