'use strict';
const identity=require('./consumer-identity');
async function readRaw(req,max=262144){
 return new Promise((resolve,reject)=>{
  const chunks=[];let size=0,done=false;
  req.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>max){done=true;reject(Object.assign(new Error('webhook_body_too_large'),{status:413}));req.resume();return;}chunks.push(chunk);});
  req.on('end',()=>{if(!done)resolve(Buffer.concat(chunks));});
  req.on('error',e=>{if(!done)reject(e);});
 });
}
async function handle({req,res,route,send,dbPool,crypto}){
 if(req.method!=='POST'||route!=='/api/consumer/identity/provider-events')return false;
 const secret=process.env.KEEL_IDENTITY_WEBHOOK_SECRET,expectedProvider=process.env.KEEL_IDENTITY_PROVIDER_ID;
 if(!secret||secret.length<32||!expectedProvider)return send(res,503,{error:'identity_provider_integration_not_configured'});
 const raw=await readRaw(req);
 let signed;
 try{signed=identity.verifyProviderWebhook({rawBody:raw,timestamp:req.headers['x-keel-timestamp'],signature:req.headers['x-keel-signature'],secret});}
 catch(e){return send(res,401,{error:e.message});}
 let body;
 try{body=JSON.parse(raw.toString('utf8'));if(!body||Array.isArray(body)||typeof body!=='object')throw new Error();}
 catch{return send(res,400,{error:'identity_provider_event_json_invalid'});}
 let event;
 try{event=identity.normalizeProviderIdentityResult(body);}
 catch(e){return send(res,400,{error:e.message});}
 if(event.provider!==expectedProvider)return send(res,403,{error:'identity_provider_not_allowlisted'});
 const providerTime=new Date(body.providerTimestamp||event.verifiedAt||Date.now());
 if(!Number.isFinite(providerTime.getTime())||Math.abs(Date.now()-providerTime.getTime())>7*86400000)return send(res,400,{error:'identity_provider_event_time_invalid'});
 if(event.expiresAt&&!Number.isFinite(Date.parse(event.expiresAt)))return send(res,400,{error:'identity_expiry_invalid'});
 const pool=await dbPool();if(!pool)return send(res,503,{error:'consumer_identity_storage_unavailable'});
 const subjectHmac=crypto.createHmac('sha256',secret).update(event.provider).update(':').update(event.externalSubjectRef).digest('hex');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const duplicate=await client.query('SELECT consumer_id FROM keel_consumer_identity_events WHERE provider_id=$1 AND provider_event_id=$2',[event.provider,event.eventId]);
  if(duplicate.rowCount){await client.query('ROLLBACK');return send(res,200,{ok:true,duplicate:true,consumerId:duplicate.rows[0].consumer_id});}
  let mapped=await client.query('SELECT consumer_id FROM keel_consumer_external_identities WHERE provider_id=$1 AND subject_hmac=$2 FOR UPDATE',[event.provider,subjectHmac]);
  let consumerId;
  if(mapped.rowCount)consumerId=mapped.rows[0].consumer_id;
  else{
   consumerId=crypto.randomUUID();
   await client.query('INSERT INTO keel_consumer_accounts(consumer_id) VALUES($1)',[consumerId]);
   await client.query('INSERT INTO keel_consumer_external_identities(provider_id,subject_hmac,consumer_id) VALUES($1,$2,$3)',[event.provider,subjectHmac,consumerId]);
  }
  await client.query('UPDATE keel_consumer_external_identities SET last_seen_at=NOW() WHERE provider_id=$1 AND subject_hmac=$2',[event.provider,subjectHmac]);
  await client.query('INSERT INTO keel_consumer_identity_events(provider_id,provider_event_id,consumer_id,event_status,assurance,evidence_hash,provider_reference,provider_timestamp) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[event.provider,event.eventId,consumerId,event.status,event.assurance,event.evidenceHash,event.externalReference,providerTime.toISOString()]);
  const mappedStatus=event.status==='verified'?'identity_verified':event.status==='review_required'?'review_required':event.status==='rejected'?'rejected':'identity_pending';
  const assurance=event.status==='verified'?event.assurance:'none';
  await client.query("UPDATE keel_consumer_accounts SET account_status=$2,identity_assurance=$3,identity_provider=$4,identity_evidence_hash=$5,identity_verified_at=CASE WHEN $2='identity_verified' THEN $6 ELSE NULL END,identity_expires_at=$7,updated_at=NOW() WHERE consumer_id=$1 AND (identity_verified_at IS NULL OR identity_verified_at<=$6 OR $2<>'identity_verified')",[consumerId,mappedStatus,assurance,event.provider,event.evidenceHash,event.verifiedAt||providerTime.toISOString(),event.expiresAt]);
  await client.query('SELECT pg_advisory_xact_lock(74021011)');
  const last=await client.query('SELECT event_fingerprint FROM keel_consumer_event_chain ORDER BY sequence DESC LIMIT 1');
  const previous=last.rowCount?last.rows[0].event_fingerprint:null;
  const eventId=crypto.randomUUID();
  const payload={provider:event.provider,providerEventId:event.eventId,consumerId,status:event.status,assurance,eventEvidenceHash:event.evidenceHash,providerTimestamp:providerTime.toISOString(),signedBodyHash:signed.bodyHash};
  const canonical=JSON.stringify({eventId,eventType:'CONSUMER_IDENTITY_PROVIDER_EVENT',subjectId:consumerId,previous,payload});
  const fingerprint=crypto.createHash('sha256').update(canonical).digest('hex');
  await client.query("INSERT INTO keel_consumer_event_chain(event_id,event_type,subject_id,previous_fingerprint,event_fingerprint,payload) VALUES($1,'CONSUMER_IDENTITY_PROVIDER_EVENT',$2,$3,$4,$5)",[eventId,consumerId,previous,fingerprint,JSON.stringify(payload)]);
  await client.query('COMMIT');
  return send(res,202,{ok:true,consumerId,identityStatus:mappedStatus,assurance,notice:'Identity documents and raw identity claims are not stored. Card ordering remains unavailable until a separate consumer authentication and provisioning channel is enabled.'});
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
module.exports={handle};
