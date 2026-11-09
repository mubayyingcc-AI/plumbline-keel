'use strict';
/** Pure deterministic Keel Payment Authority evaluator. No persistence or execution. */
const DECISIONS=Object.freeze({ALLOW:'ALLOW_WITHIN_MANDATE',APPROVAL:'HUMAN_APPROVAL_REQUIRED',HOLD:'HOLD',DENY:'DENY'});
const CHANNELS=new Set(['bank_api','card','agent_protocol','supplier_api','wallet_provider']);
const FIELDS=['amountMinor','currency','purpose','payeeId','merchantId','channel','fundingSourceId'];
function fail(m){throw new Error(m)}
function obj(x){return x!==null&&typeof x==='object'&&!Array.isArray(x)}
function integer(v,k){if(typeof v!=='string'||!/^\d+$/.test(v))fail(k+'_must_be_integer_string');const n=BigInt(v);if(n<=0n)fail(k+'_must_be_positive');return n}
function canonicalIntent(x){if(!obj(x))fail('intent_required');const o={};for(const k of FIELDS){if(typeof x[k]!=='string'||!x[k].trim())fail('intent_'+k+'_required');o[k]=k==='amountMinor'?integer(x[k],k).toString():x[k].trim()}if(!CHANNELS.has(o.channel))fail('unsupported_payment_channel');if(!/^[A-Z]{3}$/.test(o.currency))fail('currency_must_be_iso_4217_code');if(typeof x.id!=='string'||!x.id.trim())fail('intent_id_required');o.id=x.id.trim();if(typeof x.agentId==='string')o.agentId=x.agentId;if(typeof x.principalId==='string')o.principalId=x.principalId;if(typeof x.periodCommittedMinor==='string'){if(!/^\d+$/.test(x.periodCommittedMinor))fail('periodCommittedMinor_must_be_integer_string');o.periodCommittedMinor=x.periodCommittedMinor}if(x.borrowing===true)o.borrowing=true;if(x.creditRequested===true)o.creditRequested=true;if(Array.isArray(x.riskFlags))o.riskFlags=[...x.riskFlags].sort();return o}
function hash(v){return require('node:crypto').createHash('sha256').update(JSON.stringify(v)).digest('hex')}
function evaluatePayment({tenantId,mandate,intent,availability,policy,now=new Date().toISOString()}) {
 if(typeof tenantId!=='string'||!tenantId.trim())fail('tenant_id_required');
 if(!obj(mandate)||!obj(availability)||!obj(policy))fail('mandate_availability_and_policy_required');
 const request=canonicalIntent(intent),deny=reason=>({decision:DECISIONS.DENY,reasons:[reason]});
 if(mandate.tenantId!==tenantId)return deny('tenant_scope_mismatch');
 if(mandate.status!=='active')return deny('mandate_not_active');
 if(!mandate.mandateId||!Number.isInteger(mandate.version)||mandate.version<1)fail('mandate_identity_or_version_invalid');
 const t=Date.parse(now),a=Date.parse(mandate.validFrom),b=Date.parse(mandate.validUntil);
 if(![t,a,b].every(Number.isFinite)||t<a||t>=b)return deny('mandate_outside_validity_window');
 if(mandate.granteeId!==intent.agentId&&mandate.granteeId!==intent.principalId)return deny('principal_not_granted');
 if(mandate.currency!==request.currency)return deny('currency_not_permitted');
 if(!Array.isArray(mandate.channels)||!mandate.channels.includes(request.channel))return deny('channel_not_permitted');
 for(const [field,key] of [['purposes','purpose'],['payeeIds','payeeId'],['merchantIds','merchantId'],['fundingSourceIds','fundingSourceId']])if(mandate[field]&&!mandate[field].includes(request[key]))return deny(key+'_not_permitted');
 if(intent.borrowing===true||intent.creditRequested===true)return deny('borrowing_not_permitted');
 const amount=integer(request.amountMinor,'amountMinor'),single=integer(mandate.maxSingleMinor,'maxSingleMinor');
 if(amount>single)return deny('single_transaction_limit_exceeded');
 if(availability.currency!==request.currency||availability.status!=='reconciled'||availability.fresh!==true||availability.restricted!==false)return {decision:DECISIONS.HOLD,reasons:['availability_not_fresh_unrestricted_and_reconciled']};
 const keys=['eligibleBalanceMinor','restrictedMinor','obligationsReserveMinor','policyReserveMinor','activeReservationsMinor','providerHoldsMinor'];
 for(const k of keys)if(typeof availability[k]!=='string'||!/^\d+$/.test(availability[k]))return {decision:DECISIONS.HOLD,reasons:['availability_component_missing_or_invalid:'+k]};
 const gross=BigInt(availability.eligibleBalanceMinor),deduct=keys.slice(1).reduce((s,k)=>s+BigInt(availability[k]),0n),available=gross>deduct?gross-deduct:0n;
 if(amount>available)return {decision:DECISIONS.DENY,reasons:['insufficient_verified_available_capacity'],availableMinor:available.toString()};
 if(typeof mandate.periodLimitMinor!=='string'||!/^\d+$/.test(mandate.periodLimitMinor))return {decision:DECISIONS.HOLD,reasons:['aggregate_limit_not_configured']};
 if(typeof intent.periodCommittedMinor!=='string'||!/^\d+$/.test(intent.periodCommittedMinor))return {decision:DECISIONS.HOLD,reasons:['aggregate_usage_not_verified']};
 const committed=BigInt(intent.periodCommittedMinor),limit=BigInt(mandate.periodLimitMinor);
 if(committed+amount>limit)return deny('aggregate_period_limit_exceeded');
 if(typeof policy.policyId!=='string'||typeof policy.version!=='string')fail('policy_version_required');
 if(policy.status!=='active')return {decision:DECISIONS.HOLD,reasons:['payment_policy_not_active']};
 const reasons=[];
 if(policy.humanApprovalAboveMinor!==undefined&&amount>BigInt(policy.humanApprovalAboveMinor))reasons.push('amount_requires_human_approval');
 if(policy.alwaysRequireHumanApproval===true)reasons.push('policy_requires_human_approval');
 if(Array.isArray(intent.riskFlags)&&intent.riskFlags.length)reasons.push('risk_flags_require_human_review');
 const mandateFingerprint=hash({mandateId:mandate.mandateId,version:mandate.version,tenantId}),intentFingerprint=hash(request);
 return {decision:reasons.length?DECISIONS.APPROVAL:DECISIONS.ALLOW,reasons,tenantId,mandateId:mandate.mandateId,mandateVersion:mandate.version,mandateFingerprint,policyId:policy.policyId,policyVersion:policy.version,intent:request,intentFingerprint,eligibleAvailableMinor:available.toString(),remainingPeriodMinor:(limit-committed-amount).toString(),evaluatedAt:now,execution:'DISABLED',note:'Evaluation only. No reservation, approval, provider instruction, debit or settlement occurred.'};
}
function assertIntentUnchanged(fp,intent){if(typeof fp!=='string'||!/^[a-f0-9]{64}$/.test(fp))fail('approval_fingerprint_invalid');return hash(canonicalIntent(intent))===fp}
function assertTransition(from,to){
 const graph={proposed:['evaluated','denied','held'],evaluated:['approval_required','held','denied','approved'],approval_required:['approved','denied','expired'],held:['evaluated','denied','expired'],approved:['instruction_created','expired','cancelled'],instruction_created:['submitted','cancelled','unknown_outcome'],submitted:['provider_pending','authorised','declined','unknown_outcome'],provider_pending:['authorised','declined','expired','unknown_outcome'],authorised:['captured','cancel_requested','reversed'],captured:['clearing','partially_refunded','refunded','disputed'],clearing:['settled','reversed','disputed'],settled:['reconciled','partially_refunded','refunded','disputed'],reconciled:['partially_refunded','refunded','disputed'],unknown_outcome:['provider_pending','authorised','declined','settled','reconciled'],cancel_requested:['cancelled','authorised','captured','unknown_outcome'],partially_refunded:['refunded','disputed'],disputed:['chargeback_won','chargeback_lost'],declined:[],expired:[],denied:[],cancelled:[],reversed:[],refunded:[],chargeback_won:[],chargeback_lost:[]};
 if(!graph[from]||!graph[from].includes(to))fail('invalid_payment_state_transition');return true
}
module.exports={DECISIONS,canonicalIntent,evaluatePayment,assertIntentUnchanged,assertTransition};
