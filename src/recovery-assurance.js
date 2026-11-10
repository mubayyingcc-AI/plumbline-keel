'use strict';
function compareLedgerProjection({accounts,lines}){
 const totals=new Map();
 for(const line of lines){
  const key=line.account_id;if(!totals.has(key))totals.set(key,{debit:0n,credit:0n});
  const t=totals.get(key),amount=BigInt(line.amount_minor);
  if(amount<0n)throw new Error('negative_ledger_line_amount');
  if(line.side==='debit')t.debit+=amount;else if(line.side==='credit')t.credit+=amount;else throw new Error('unknown_ledger_line_side');
 }
 const findings=[];
 for(const a of accounts){
  const t=totals.get(a.account_id)||{debit:0n,credit:0n};
  const expected=a.normal_side==='debit'?t.debit-t.credit:t.credit-t.debit;
  const actualDebit=BigInt(a.debit_total),actualCredit=BigInt(a.credit_total),actualBalance=BigInt(a.normal_balance_minor);
  if(actualDebit!==t.debit||actualCredit!==t.credit||actualBalance!==expected)findings.push({
   accountId:a.account_id,code:'LEDGER_PROJECTION_MISMATCH',
   expected:{debitTotalMinor:t.debit.toString(),creditTotalMinor:t.credit.toString(),balanceMinor:expected.toString()},
   actual:{debitTotalMinor:actualDebit.toString(),creditTotalMinor:actualCredit.toString(),balanceMinor:actualBalance.toString()}
  });
 }
 return {valid:findings.length===0,accountCount:accounts.length,postedLineCount:lines.length,findings};
}
function assessRecoveryState({ledger,providerOutbox=[],providerCases=[]}){
 const warnings=[];
 const leased=providerOutbox.filter(x=>x.status==='leased');
 const unknown=providerOutbox.filter(x=>x.status==='unknown');
 const exceptions=providerCases.filter(x=>['exception','quarantined','pending'].includes(x.status));
 if(leased.length)warnings.push({code:'LEASED_INSTRUCTIONS_REQUIRE_MANUAL_RECOVERY_REVIEW',count:leased.length});
 if(unknown.length)warnings.push({code:'UNKNOWN_PROVIDER_OUTCOMES_REQUIRE_RECONCILIATION',count:unknown.length});
 if(exceptions.length)warnings.push({code:'OPEN_PROVIDER_RECONCILIATION_CASES',count:exceptions.length});
 return {valid:ledger.valid,warnings,provider:{outboxCount:providerOutbox.length,unknownCount:unknown.length,leasedCount:leased.length,openCaseCount:exceptions.length}};
}
module.exports={compareLedgerProjection,assessRecoveryState};
