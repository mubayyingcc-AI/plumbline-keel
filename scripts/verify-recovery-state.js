'use strict';
const {Pool}=require('pg');
const {compareLedgerProjection,assessRecoveryState}=require('../src/recovery-assurance');
const ledgerPosting=require('../src/ledger-posting');

async function main(){
  if(process.env.KEEL_RECOVERY_TARGET!=='isolated')throw new Error('REFUSING_TO_RUN: set KEEL_RECOVERY_TARGET=isolated only for a clean isolated restore target');
  if(!process.env.PG_ADMIN_URL||!process.env.DATABASE_URL)throw new Error('PG_ADMIN_URL and restricted-runtime DATABASE_URL are required for an isolated restore target');
  const started=Date.now(),admin=new Pool({connectionString:process.env.PG_ADMIN_URL,ssl:process.env.PGSSLMODE==='require'?{rejectUnauthorized:true}:false,max:2});
  const runtime=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSLMODE==='require'?{rejectUnauthorized:true}:false,max:4});
  try{
    const role=await runtime.query("SELECT current_user AS role_name, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user");
    if(!role.rowCount||role.rows[0].rolsuper||role.rows[0].rolbypassrls)throw new Error('recovery_verifier_requires_non_superuser_non_bypass_runtime_role');
    const migrations=await admin.query("SELECT version FROM keel_schema_migrations WHERE version='019_kAAA_provider_authority_event_type.sql'");
    if(!migrations.rowCount)throw new Error('required_kAAA_provider_authority_migration_019_missing');
    const tenants=await admin.query("SELECT tenant_id FROM keel_tenants WHERE status='active' ORDER BY tenant_id");
    if(!tenants.rowCount)throw new Error('no_active_tenants_found_on_restore_target');
    const results=[];
    for(const tenantRow of tenants.rows){
      const tenantId=tenantRow.tenant_id,client=await runtime.connect();
      try{
        await client.query('BEGIN READ ONLY');
        await client.query("SELECT set_config('keel.tenant_id',$1,true)",[tenantId]);
        const accounts=(await client.query(`SELECT a.account_id,a.normal_side,COALESCE(b.debit_total,0)::text AS debit_total,
          COALESCE(b.credit_total,0)::text AS credit_total,COALESCE(b.normal_balance_minor,0)::text AS normal_balance_minor
          FROM keel_ledger_accounts a LEFT JOIN keel_ledger_account_balances b
          ON b.tenant_id=a.tenant_id AND b.account_id=a.account_id
          WHERE a.tenant_id=$1 AND a.status<>'deleted' ORDER BY a.account_id`,[tenantId])).rows;
        const lines=(await client.query(`SELECT l.account_id,l.side,l.amount_minor::text
          FROM keel_ledger_lines l JOIN keel_ledger_journals j
          ON j.tenant_id=l.tenant_id AND j.journal_id=l.journal_id
          WHERE l.tenant_id=$1 AND j.status='posted'`,[tenantId])).rows;
        const outbox=(await client.query('SELECT status FROM keel_provider_outbox WHERE tenant_id=$1',[tenantId])).rows;
        const cases=(await client.query('SELECT status FROM keel_provider_reconciliation_cases WHERE tenant_id=$1',[tenantId])).rows;
        const crossTenant=await client.query('SELECT COUNT(*)::text AS count FROM keel_ledger_accounts WHERE tenant_id<>$1',[tenantId]);
        if(crossTenant.rows[0].count!=='0')throw new Error('tenant_rls_cross_tenant_visibility_detected:'+tenantId);
        await client.query('COMMIT');
        const ledger=compareLedgerProjection({accounts,lines});
        const provider=assessRecoveryState({ledger,providerOutbox:outbox,providerCases:cases});
        const eventChain=await ledgerPosting.verifyLedgerEventChain(runtime,tenantId);
        results.push({tenantId,valid:ledger.valid&&eventChain.valid,ledger,provider,eventChain});
      }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
      finally{client.release();}
    }
    const report={valid:results.every(x=>x.valid),tenantCount:results.length,results,verifiedAt:new Date().toISOString(),verificationDurationMs:Date.now()-started,role:role.rows[0].role_name,migration019Applied:true};
    process.stdout.write(JSON.stringify(report,null,2)+'\\n');
    if(!report.valid)process.exitCode=2;
  }finally{await runtime.end();await admin.end();}
}
main().catch(error=>{process.stderr.write('keel_recovery_verification_failed '+String(error.stack||error)+'\\n');process.exitCode=1;});
