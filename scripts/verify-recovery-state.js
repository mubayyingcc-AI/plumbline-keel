'use strict';
const {Pool}=require('pg');
const {compareLedgerProjection,assessRecoveryState}=require('../src/recovery-assurance');
async function main(){
 if(process.env.KEEL_RECOVERY_TARGET!=='isolated')throw new Error('REFUSING_TO_RUN: set KEEL_RECOVERY_TARGET=isolated only for a clean isolated restore target');
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required for the isolated restore target');
 const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSLMODE==='require'?{rejectUnauthorized:true}:undefined});
 const client=await pool.connect();
 try{
  await client.query('BEGIN READ ONLY');
  const accounts=(await client.query(`SELECT a.account_id,a.normal_side,b.debit_total::text,b.credit_total::text,b.normal_balance_minor::text
   FROM keel_ledger_accounts a JOIN keel_ledger_account_balances b USING(tenant_id,account_id) WHERE a.status<>'deleted' ORDER BY a.tenant_id,a.account_id`)).rows;
  const lines=(await client.query(`SELECT l.account_id,l.side,l.amount_minor::text FROM keel_ledger_lines l JOIN keel_ledger_journals j USING(tenant_id,journal_id) WHERE j.status='posted'`)).rows;
  const outbox=(await client.query('SELECT status FROM keel_provider_outbox')).rows;
  const cases=(await client.query('SELECT status FROM keel_provider_reconciliation_cases')).rows;
  const ledger=compareLedgerProjection({accounts,lines}),report=assessRecoveryState({ledger,providerOutbox:outbox,providerCases:cases});
  process.stdout.write(JSON.stringify({...report,generatedAt:new Date().toISOString()},null,2)+'\\n');
  if(!report.valid)process.exitCode=2;
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
 finally{client.release();await pool.end();}
}
main().catch(e=>{process.stderr.write(String(e.stack||e)+'\\n');process.exitCode=1;});
