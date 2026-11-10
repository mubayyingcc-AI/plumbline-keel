'use strict';
const {Pool}=require('pg');
const crypto=require('node:crypto');
const lifecycle=require('../src/provider-lifecycle');
const {ProviderSandboxAdapter,createDeterministicSandboxTransport}=require('../src/provider-sandbox-adapter');

function requiredEnv(name){
  const value=process.env[name];
  if(!value||!value.trim())throw new Error(name+'_required');
  return value.trim();
}
async function runOnce({pool,tenantId,actor,envelopeId,adapter}){
  if(!pool||!tenantId||!actor||!actor.principal_id||!actor.key_id||!envelopeId||!adapter)throw new Error('sandbox_worker_configuration_incomplete');
  const authorityContext={actor,envelopeId};
  const claimed=await lifecycle.claimNextInstruction(pool,tenantId,actor.principal_id,45,authorityContext,['bank-sandbox']);
  if(!claimed)return {status:'NO_WORK'};
  let dispatched;
  try{
    dispatched=await adapter.dispatch({idempotencyKey:claimed.idempotency_key,payload:claimed.payload});
  }catch(_){
    dispatched={outcome:'unknown',errorCode:'SANDBOX_TRANSPORT_OUTCOME_UNKNOWN'};
  }
  const outcome=await lifecycle.recordDispatchOutcome(pool,tenantId,{
    outboxId:claimed.outbox_id,workerId:actor.principal_id,outcome:dispatched.outcome,
    providerInstructionId:dispatched.providerInstructionId,errorCode:dispatched.errorCode,
    safeToRetry:false
  },authorityContext);
  return {status:outcome.status,outboxId:claimed.outbox_id,providerInstructionId:outcome.provider_instruction_id||null,sandbox:true,authorityProofId:outcome.authorityProof.proofId};
}
async function main(){
  const tenantId=requiredEnv('KEEL_WORKER_TENANT_ID');
  const actor={tenant_id:tenantId,principal_id:requiredEnv('KEEL_WORKER_PRINCIPAL_ID'),key_id:requiredEnv('KEEL_WORKER_KEY_ID'),role:'integration'};
  const envelopeId=requiredEnv('KEEL_WORKER_AUTHORITY_ENVELOPE_ID');
  const ephemeralKeyId='sandbox-worker-ephemeral';
  const ephemeralSecret=crypto.randomBytes(32).toString('hex');
  const adapter=new ProviderSandboxAdapter({providerId:'bank-sandbox',transport:createDeterministicSandboxTransport({outcome:process.env.KEEL_SANDBOX_OUTCOME||'accepted'}),keyring:{[ephemeralKeyId]:ephemeralSecret},activeKeyId:ephemeralKeyId});
  const pool=new Pool({connectionString:requiredEnv('DATABASE_URL'),max:2,connectionTimeoutMillis:10000});
  try{
    const result=await runOnce({pool,tenantId,actor,envelopeId,adapter});
    process.stdout.write(JSON.stringify(result)+'\n');
  }finally{await pool.end();}
}
if(require.main===module)main().catch(error=>{process.stderr.write('keel_sandbox_worker_failed '+error.message+'\n');process.exitCode=1;});
module.exports={runOnce};
