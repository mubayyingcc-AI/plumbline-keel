'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {Pool}=require('pg');
const ledger=require('../src/ledger-posting');
const {createCheckpoint}=require('../src/independent-proof-checkpoint');
function required(name){const v=process.env[name];if(!v||!v.trim())throw new Error(name+'_required');return v;}
async function main(){
 const admin=new Pool({connectionString:required('PG_ADMIN_URL'),max:2});
 const runtime=new Pool({connectionString:required('DATABASE_URL'),max:4});
 const privateKey=required('KEEL_CHECKPOINT_SIGNING_PRIVATE_KEY');
 const keyId=required('KEEL_CHECKPOINT_SIGNING_KEY_ID');
 const output=path.resolve(process.env.KEEL_CHECKPOINT_OUTPUT_DIR||'./keel-checkpoints');
 const databaseIdentity=process.env.KEEL_CHECKPOINT_DATABASE_ID||'unspecified';
 try{
  const role=await runtime.query("SELECT current_user AS role_name, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user");
  if(!role.rowCount||role.rows[0].rolsuper||role.rows[0].rolbypassrls)throw new Error('checkpoint_export_requires_restricted_runtime_role');
  const tenants=await admin.query("SELECT tenant_id FROM keel_tenants WHERE status='active' ORDER BY tenant_id");
  if(!tenants.rowCount)throw new Error('no_active_tenants_for_checkpoint');
  fs.mkdirSync(output,{recursive:true,mode:0o700});
  const results=[];
  for(const row of tenants.rows){
   const verified=await ledger.verifyLedgerEventChain(runtime,row.tenant_id);
   if(!verified.valid)throw new Error('ledger_chain_invalid_for_tenant:'+row.tenant_id);
   const checkpoint=createCheckpoint({tenantId:row.tenant_id,verifiedEvents:verified.verifiedEvents,headFingerprint:verified.headFingerprint||null,keyId,privateKey,databaseIdentity});
   const stamp=checkpoint.createdAt.replace(/[:.]/g,'-');
   const filename=path.join(output,row.tenant_id+'.'+stamp+'.checkpoint.json');
   fs.writeFileSync(filename,JSON.stringify(checkpoint,null,2)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
   results.push({tenantId:row.tenant_id,verifiedEvents:verified.verifiedEvents,headFingerprint:verified.headFingerprint||null,file:filename});
  }
  process.stdout.write(JSON.stringify({ok:true,algorithm:'Ed25519',keyId,databaseIdentity,tenantCount:results.length,checkpoints:results},null,2)+'\n');
 }finally{await runtime.end();await admin.end();}
}
main().catch(e=>{process.stderr.write('independent_checkpoint_export_failed '+String(e.stack||e)+'\n');process.exitCode=1;});
