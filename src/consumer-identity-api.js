'use strict';
const identity=require('./consumer-identity');
const sessionVerifier=require('./consumer-session');
const cardProvisioning=require('./human-card-provisioning');
async function readRaw(req,max=262144){
 return new Promise((resolve,reject)=>{
  const chunks=[];let size=0,done=false;
  req.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>max){done=true;reject(Object.assign(new Error('webhook_body_too_large'),{status:413}));req.resume();return;}chunks.push(chunk);});
  req.on('end',()=>{if(!done)resolve(Buffer.concat(chunks));});
  req.on('error',e=>{if(!done)reject(e);});
 });
}
async function appendConsumerEvent(client,crypto,{eventType,subjectId,payload}){
 await client.query('SELECT pg_advisory_xact_lock(74021011)');
 const last=await client.query('SELECT event_fingerprint FROM keel_consumer_event_chain ORDER BY sequence DESC LIMIT 1');
 const previous=last.rowCount?last.rows[0].event_fingerprint:null,eventId=crypto.randomUUID();
 const canonical=JSON.stringify({eventId,eventType,subjectId,previous,payload});
 const fingerprint=crypto.createHash('sha256').update(canonical).digest('hex');
 await client.query('INSERT INTO keel_consumer_event_chain(event_id,event_type,subject_id,previous_fingerprint,event_fingerprint,payload) VALUES($1,$2,$3,$4,$5,$6)',[eventId,eventType,subjectId,previous,fingerprint,JSON.stringify(payload)]);
}
async function consumerActor(req,{crypto}){
 const token=String(req.headers.authorization||'').match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
 if(!token)throw new Error('consumer_session_required');
 const cfg={publicKeyPem:process.env.KEEL_CONSUMER_SESSION_PUBLIC_KEY_PEM,issuer:process.env.KEEL_CONSUMER_SESSION_ISSUER,audience:process.env.KEEL_CONSUMER_SESSION_AUDIENCE,keyId:process.env.KEEL_CONSUMER_SESSION_KEY_ID};
 if(!cfg.publicKeyPem||!cfg.issuer||!cfg.audience||!cfg.keyId)throw new Error('consumer_session_verification_not_configured');
 if(cfg.issuer!==process.env.KEEL_IDENTITY_PROVIDER_ISSUER)throw new Error('consumer_session_issuer_provider_mismatch');
 const verified=sessionVerifier.verifyConsumerSession(token,cfg);
 const secret=process.env.KEEL_CONSUMER_SUBJECT_HMAC_KEY,provider=process.env.KEEL_IDENTITY_PROVIDER_ID;
 if(!secret||secret.length<32||!provider)throw new Error('consumer_subject_hmac_key_not_configured');
 const subjectHmac=crypto.createHmac('sha256',secret).update(provider).update(':').update(verified.subject).digest('hex');
 return {provider,subjectHmac,tokenId:verified.tokenId};
}
async function handle({req,res,route,send,dbPool,crypto,readBody,sameOriginIfBrowser}){
 const identityWebhook=req.method==='POST'&&route==='/api/consumer/identity/provider-events';
 const profile=req.method==='GET'&&route==='/api/consumer/me';
 const order=req.method==='POST'&&route==='/api/consumer/card-orders';
 if(!identityWebhook&&!profile&&!order)return false;
 if(!identityWebhook){
  if(!sameOriginIfBrowser(req))return send(res,403,{error:'origin_not_allowed'});
  let actor;try{actor=await consumerActor(req,{crypto});}catch(e){return send(res,401,{error:e.message});}
  const pool=await dbPool();if(!pool)return send(res,503,{error:'consumer_identity_storage_unavailable'});
  const q=await pool.query("SELECT a.consumer_id,a.account_status,a.identity_assurance,a.identity_expires_at FROM keel_consumer_external_identities i JOIN keel_consumer_accounts a ON a.consumer_id=i.consumer_id WHERE i.provider_id=$1 AND i.subject_hmac=$2",[actor.provider,actor.subjectHmac]);
  if(!q.rowCount)return send(res,404,{error:'consumer_account_not_found'});
  const account=q.rows[0];
  if(profile){
   const orders=await pool.query('SELECT order_id,card_product,delivery_country,status,created_at,updated_at FROM keel_human_card_orders WHERE consumer_id=$1 ORDER BY created_at DESC LIMIT 20',[account.consumer_id]);
   return send(res,200,{consumer:{consumerId:account.consumer_id,accountStatus:account.account_status,identityAssurance:account.identity_assurance,identityExpiresAt:account.identity_expires_at},cardOrders:orders.rows,notice:'No identity documents, home address or card credentials are returned.'});
  }
  if(account.account_status!=='identity_verified'||!account.identity_expires_at||new Date(account.identity_expires_at)<=new Date())return send(res,403,{error:'current_verified_identity_required'});
  let request;try{request=cardProvisioning.normalizeOrderRequest(await readBody(req));}catch(e){return send(res,400,{error:e.message});}
  const idempotency=String(req.headers['idempotency-key']||'');
  if(!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotency))return send(res,400,{error:'valid_idempotency_key_required'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const locked=await client.query('SELECT account_status,identity_expires_at FROM keel_consumer_accounts WHERE consumer_id=$1 FOR UPDATE',[account.consumer_id]);
   if(!locked.rowCount||locked.rows[0].account_status!=='identity_verified'||!locked.rows[0].identity_expires_at||new Date(locked.rows[0].identity_expires_at)<=new Date()){
    await client.query('ROLLBACK');return send(res,403,{error:'current_verified_identity_required'});
   }
   const inserted=await client.query("INSERT INTO keel_human_card_orders(order_id,idempotency_key,consumer_id,card_product,delivery_country,status) VALUES($1,$2,$3,$4,$5,'submitted') ON CONFLICT(consumer_id,idempotency_key) DO NOTHING RETURNING order_id",[crypto.randomUUID(),idempotency,account.consumer_id,request.cardProduct,request.deliveryRegion]);
   const saved=await client.query('SELECT order_id,card_product,delivery_country,status,created_at FROM keel_human_card_orders WHERE consumer_id=$1 AND idempotency_key=$2',[account.consumer_id,idempotency]);
   if(!saved.rowCount)throw new Error('card_order_request_persistence_failed');
   if(saved.rows[0].card_product!==request.cardProduct||saved.rows[0].delivery_country!==request.deliveryRegion){
    await client.query('ROLLBACK');return send(res,409,{error:'idempotency_key_reused_with_different_card_order'});
   }
   if(inserted.rowCount)await appendConsumerEvent(client,crypto,{eventType:'HUMAN_CARD_ORDER_REQUESTED',subjectId:account.consumer_id,payload:{orderId:saved.rows[0].order_id,cardProduct:request.cardProduct,deliveryCountry:request.deliveryRegion}});
   await client.query('COMMIT');
   return send(res,inserted.rowCount?202:200,{ok:true,duplicate:!inserted.rowCount,order:saved.rows[0],physicalCardOrdered:false,nextStep:'card_partner_acceptance',notice:'This is a Keel order request only. No card has been manufactured, dispatched or charged for. A verified card partner must accept it before fulfilment.'});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
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
 const subjectKey=process.env.KEEL_CONSUMER_SUBJECT_HMAC_KEY;
 if(!subjectKey||subjectKey.length<32)return send(res,503,{error:'consumer_subject_hmac_key_not_configured'});
 const subjectHmac=crypto.createHmac('sha256',subjectKey).update(event.provider).update(':').update(event.externalSubjectRef).digest('hex');
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
  await client.query('INSERT INTO keel_consumer_identity_events(provider_id,provider_event_id,consumer_id,event_status,assurance,evidence_hash,provider_reference,provider_timestamp) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[event.provider,event.eventId,consumerId,event.status,event.assurance,event.evidenceHash,crypto.createHash('sha256').update(event.externalReference).digest('hex'),providerTime.toISOString()]);
  const mappedStatus=event.status==='verified'?'identity_verified':event.status==='review_required'?'review_required':event.status==='rejected'?'rejected':event.status==='expired'?'expired':'identity_pending';
  const assurance=event.status==='verified'?event.assurance:'none';
  await client.query("UPDATE keel_consumer_accounts SET account_status=$2,identity_assurance=$3,identity_provider=$4,identity_evidence_hash=$5,identity_verified_at=CASE WHEN $2='identity_verified' THEN $6 ELSE NULL END,identity_expires_at=$7,last_provider_event_at=$8,updated_at=NOW() WHERE consumer_id=$1 AND (last_provider_event_at IS NULL OR last_provider_event_at<=$8)",[consumerId,mappedStatus,assurance,event.provider,event.evidenceHash,event.verifiedAt||providerTime.toISOString(),event.expiresAt,providerTime.toISOString()]);
  const payload={provider:event.provider,providerEventId:event.eventId,consumerId,status:event.status,assurance,eventEvidenceHash:event.evidenceHash,providerTimestamp:providerTime.toISOString(),signedBodyHash:signed.bodyHash};
  await appendConsumerEvent(client,crypto,{eventType:'CONSUMER_IDENTITY_PROVIDER_EVENT',subjectId:consumerId,payload});
  await client.query('COMMIT');
  return send(res,202,{ok:true,consumerId,identityStatus:mappedStatus,assurance,notice:'Identity documents and raw identity claims are not stored. Consumer card-order requests require a separate short-lived signed session and do not represent card issuance.'});
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
module.exports={handle};
