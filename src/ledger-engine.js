'use strict';
const crypto=require('node:crypto');
const {canonical}=require('./authority-chain');

const SIDES=new Set(['debit','credit']);
const CURRENCY=/^[A-Z]{3}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
function required(v,name,max=120){
 if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error(name+'_required');
 return v.trim();
}
function units(v,name='amountMinor'){
 if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(v))throw new Error(name+'_must_be_nonnegative_integer_string');
 if(BigInt(v)<=0n)throw new Error(name+'_must_be_positive');
 return v;
}
function normaliseLine(line,index){
 if(!line||typeof line!=='object'||Array.isArray(line))throw new Error('journal_line_invalid:'+index);
 const accountId=required(line.accountId,'account_id');
 const side=required(line.side,'side',8);
 if(!SIDES.has(side))throw new Error('journal_line_side_invalid');
 const currency=required(line.currency,'currency',3);
 if(!CURRENCY.test(currency))throw new Error('journal_line_currency_invalid');
 return Object.freeze({accountId,side,currency,amountMinor:units(line.amountMinor)});
}
function validateJournal(journal){
 if(!journal||typeof journal!=='object'||Array.isArray(journal))throw new Error('journal_required');
 const tenantId=required(journal.tenantId,'tenant_id',80);
 const journalId=required(journal.journalId,'journal_id');
 if(!ID.test(journalId))throw new Error('journal_id_invalid');
 const idempotencyKey=required(journal.idempotencyKey,'idempotency_key',128);
 if(idempotencyKey.length<16)throw new Error('idempotency_key_too_short');
 const description=required(journal.description,'description',500);
 const sourceRef=required(journal.sourceRef,'source_ref',300);
 const effectiveAt=required(journal.effectiveAt,'effective_at',80);
 if(!Number.isFinite(Date.parse(effectiveAt)))throw new Error('effective_at_invalid');
 if(!Array.isArray(journal.lines)||journal.lines.length<2||journal.lines.length>500)throw new Error('journal_lines_count_invalid');
 const lines=journal.lines.map(normaliseLine);
 const byCurrency={};
 for(const line of lines){
  const sums=byCurrency[line.currency]||(byCurrency[line.currency]={debit:0n,credit:0n,lineCount:0});
  sums[line.side]+=BigInt(line.amountMinor);sums.lineCount++;
 }
 for(const [currency,sums] of Object.entries(byCurrency)){
  if(sums.debit!==sums.credit)throw new Error('journal_unbalanced:'+currency);
  if(sums.debit===0n)throw new Error('journal_zero_value:'+currency);
 }
 const lineAccounts=new Set(lines.map(x=>x.accountId));
 if(lineAccounts.size<2)throw new Error('journal_requires_distinct_accounts');
 const reversalOfJournalId=journal.reversalOfJournalId==null?null:required(journal.reversalOfJournalId,'reversal_of_journal_id');
 if(reversalOfJournalId===journalId)throw new Error('journal_cannot_reverse_itself');
 const normalised={tenantId,journalId,idempotencyKey,description,sourceRef,effectiveAt:new Date(Date.parse(effectiveAt)).toISOString(),reversalOfJournalId,lines};
 const fingerprint=crypto.createHash('sha256').update(canonical(normalised)).digest('hex');
 return Object.freeze({...normalised,totalsByCurrency:Object.fromEntries(Object.entries(byCurrency).map(([k,v])=>[k,v.debit.toString()])),lineCount:lines.length,fingerprint,status:'validated_not_posted'});
}
function buildJournal(input){return validateJournal(input);}
function buildReversal({original,tenantId,journalId,idempotencyKey,description,effectiveAt}){
 const source=validateJournal(original);
 if(source.tenantId!==tenantId)throw new Error('reversal_tenant_mismatch');
 return validateJournal({
  tenantId,journalId,idempotencyKey,description:description||('Reversal of '+source.journalId),
  sourceRef:'reversal:'+source.journalId,effectiveAt,reversalOfJournalId:source.journalId,
  lines:source.lines.map(line=>({accountId:line.accountId,side:line.side==='debit'?'credit':'debit',currency:line.currency,amountMinor:line.amountMinor}))
 });
}
function assertSameJournal(existing,incoming){
 const a=validateJournal(existing),b=validateJournal(incoming);
 return a.tenantId===b.tenantId&&a.fingerprint===b.fingerprint;
}
module.exports={SIDES,normaliseLine,validateJournal,buildJournal,buildReversal,assertSameJournal};
