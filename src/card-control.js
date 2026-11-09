'use strict';
/** Deterministic card-profile and funding-capacity rules. Persistence/execution belong to server adapters. */
const CARD_CHANNELS=new Set(['virtual','physical']);
function fail(code){throw new Error(code)}
function required(v,k){if(typeof v!=='string'||!v.trim())fail(k+'_required');return v.trim()}
function minor(v,k){if(typeof v!=='string'||!/^\d+$/.test(v))fail(k+'_must_be_integer_minor_units');return BigInt(v)}
function createCardProfile(x){
 if(!x||typeof x!=='object'||Array.isArray(x))fail('card_profile_required');
 const channel=required(x.channel,'channel'),mode=required(x.issuanceMode,'issuance_mode');
 if(!CARD_CHANNELS.has(channel))fail('unsupported_card_channel');
 if(!['sandbox','partner_issued'].includes(mode))fail('unsupported_issuance_mode');
 const currency=required(x.currency,'currency').toUpperCase();if(!/^[A-Z]{3}$/.test(currency))fail('invalid_currency');
 const base={cardId:required(x.cardId,'card_id'),principalId:required(x.principalId,'principal_id'),programmeId:required(x.programmeId,'programme_id'),mandateId:required(x.mandateId,'mandate_id'),mandateVersion:x.mandateVersion,currency,channel,issuanceMode:mode};
 if(!Number.isInteger(base.mandateVersion)||base.mandateVersion<1)fail('mandate_version_invalid');
 if(mode==='sandbox'){if(x.providerCardRef||x.providerTokenRef||x.lastFour)fail('sandbox_card_cannot_contain_provider_credentials');return {...base,status:'sandbox',display:{label:'SANDBOX — NOT A PAYMENT CARD',maskedReference:'KEEL-SANDBOX-'+base.cardId.slice(-6).toUpperCase()},execution:'DISABLED'}}
 const providerId=required(x.providerId,'provider_id');if(!x.providerCardRef||!x.providerTokenRef)fail('partner_card_token_references_required');
 const lastFour=x.lastFour==null?null:String(x.lastFour);if(lastFour!==null&&!/^\d{4}$/.test(lastFour))fail('last_four_invalid');
 return {...base,providerId,providerCardRef:required(x.providerCardRef,'provider_card_ref'),providerTokenRef:required(x.providerTokenRef,'provider_token_ref'),lastFour,status:'requested',execution:'PARTNER_ONLY'};
}
function calculateAvailable(p,reservations,now=new Date()){
 if(!p||!Array.isArray(reservations))fail('funding_position_and_reservations_required');
 const reasons=[],fields=['eligibleBalanceMinor','restrictedMinor','obligationsMinor','policyReserveMinor','providerHoldsMinor'],v={};
 if(!['provider_authenticated','independently_verified'].includes(p.verificationClass))reasons.push('SOURCE_NOT_AUTHENTICATED');
 if(p.signatureVerified!==true)reasons.push('SOURCE_SIGNATURE_NOT_VERIFIED');
 if(p.reconciliationState!=='reconciled')reasons.push('SOURCE_NOT_RECONCILED');
 const t=now instanceof Date?now.getTime():Date.parse(now),observed=Date.parse(p.observedAt),expires=Date.parse(p.expiresAt);
 if(!Number.isFinite(t)||!Number.isFinite(observed)||!Number.isFinite(expires)||observed>t+60000||expires<=t)reasons.push('SOURCE_STALE_OR_INVALID');
 for(const k of fields){try{v[k]=minor(p[k],k)}catch{reasons.push('MISSING_OR_INVALID_'+k.toUpperCase())}}
 let reserved=0n;for(const r of reservations)if(['active','provider_hold'].includes(r.state)){if(r.currency!==p.currency){reasons.push('CROSS_CURRENCY_RESERVATION');continue}try{reserved+=minor(r.amountMinor,'reservation_amount')}catch{reasons.push('INVALID_RESERVATION_AMOUNT')}}
 if(reasons.length)return {status:'HOLD',availableMinor:null,reservedMinor:reserved.toString(),reasons};
 const n=v.eligibleBalanceMinor-v.restrictedMinor-v.obligationsMinor-v.policyReserveMinor-v.providerHoldsMinor-reserved;
 return {status:n>=0n?'VERIFIED':'HOLD',availableMinor:n>0n?n.toString():'0',reservedMinor:reserved.toString(),reasons:n>=0n?[]:['POSITION_COMPONENTS_EXCEED_ELIGIBLE_BALANCE']};
}
function reserveCapacity(x){
 const amount=minor(x.amountMinor,'amount_minor');if(amount<=0n)fail('amount_must_be_positive');
 required(x.idempotencyKey,'idempotency_key');if(x.idempotencyKey.length<16||x.idempotencyKey.length>128)fail('idempotency_key_invalid');
 if(x.existingFingerprint){if(x.existingFingerprint!==x.requestFingerprint)fail('idempotency_key_payload_conflict');return {status:'IDEMPOTENT_REPLAY',reserved:false}}
 if(x.currency!==x.position.currency)fail('currency_mismatch');
 const a=calculateAvailable(x.position,x.reservations,x.now);
 if(a.status!=='VERIFIED')return {status:'HOLD',reserved:false,reasons:a.reasons};
 if(amount>BigInt(a.availableMinor))return {status:'DENIED',reserved:false,reasons:['INSUFFICIENT_VERIFIED_AVAILABLE_CAPACITY'],availableMinor:a.availableMinor};
 return {status:'RESERVATION_ELIGIBLE',reserved:false,amountMinor:amount.toString(),availableAfterMinor:(BigInt(a.availableMinor)-amount).toString(),note:'Eligibility only. A database row lock and transaction must create the persistent reservation.'};
}
const transitions={sandbox:[],requested:['pending_activation','failed','suspended'],pending_activation:['active','failed','suspended'],active:['suspended','terminated'],suspended:['active','terminated'],failed:[],terminated:[]};
function assertCardTransition(from,to){if(!transitions[from]||!transitions[from].includes(to))fail('invalid_card_state_transition');return true}
module.exports={createCardProfile,calculateAvailable,reserveCapacity,assertCardTransition};
