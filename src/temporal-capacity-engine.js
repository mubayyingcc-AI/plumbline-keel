'use strict';
const crypto=require('node:crypto');
const {canonical}=require('./authority-chain');

const BPS=10000n;
const STATES=new Set(['draft','verified','active','delivery_in_progress','fulfilled','disputed','defaulted','cancelled']);
function fail(code){throw Object.assign(new Error(code),{code});}
function integer(v,name,{min=0n,max=10n**78n}={}){if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(v))fail(name+'_must_be_integer_string');const n=BigInt(v);if(n<min||n>max)fail(name+'_out_of_range');return n;}
function bps(v,name){const n=integer(v,name,{max:BPS});return n;}
function hash(v){return crypto.createHash('sha256').update(canonical(v)).digest('hex');}
function assessTemporalCapacity(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('temporal_capacity_input_required');
 const required=['contractId','tenantId','buyerRef','providerRef','serviceType','unit','contractedUnits','deliveredUnits','unitPriceMinor','currency','deliveryStart','deliveryEnd','contractStatus','buyerPaymentSupport','providerCapacityEvidence','performanceEvidence','disputeStatus','sourceEvidenceRefs','policy'];
 for(const k of required)if(input[k]===undefined||input[k]===null)fail('missing_'+k);
 for(const k of ['contractId','tenantId','buyerRef','providerRef','serviceType','unit','currency'])if(typeof input[k]!=='string'||!input[k].trim())fail('invalid_'+k);
 const contracted=integer(input.contractedUnits,'contracted_units',{min:1n}),delivered=integer(input.deliveredUnits,'delivered_units');
 if(delivered>contracted)fail('delivered_exceeds_contracted');
 const price=integer(input.unitPriceMinor,'unit_price_minor',{min:1n});
 const start=Date.parse(input.deliveryStart),end=Date.parse(input.deliveryEnd);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)fail('invalid_delivery_window');
 if(!STATES.has(input.contractStatus))fail('invalid_contract_status');
 if(!Array.isArray(input.sourceEvidenceRefs)||input.sourceEvidenceRefs.length===0||input.sourceEvidenceRefs.some(x=>typeof x!=='string'||!x.trim()))fail('source_evidence_required');
 const p=input.policy;
 if(!p||typeof p!=='object'||typeof p.id!=='string'||typeof p.version!=='string')fail('versioned_policy_required');
 const maxAdvanceBps=bps(p.maxAdvanceBps,'max_advance_bps'),performanceBps=bps(p.performanceBps,'performance_bps'),buyerSupportBps=bps(p.buyerSupportBps,'buyer_support_bps'),capacityBps=bps(p.capacityBps,'capacity_bps'),disputeReserveBps=bps(p.disputeReserveBps,'dispute_reserve_bps');
 const gross=contracted*price,unearned=(contracted-delivered)*price;
 const holds=[];
 if(input.contractStatus!=='active'&&input.contractStatus!=='delivery_in_progress')holds.push('CONTRACT_NOT_ACTIVE');
 if(input.buyerPaymentSupport!=='verified')holds.push('BUYER_PAYMENT_SUPPORT_NOT_VERIFIED');
 if(input.providerCapacityEvidence!=='verified')holds.push('PROVIDER_CAPACITY_NOT_VERIFIED');
 if(input.performanceEvidence!=='verified')holds.push('PERFORMANCE_HISTORY_NOT_VERIFIED');
 if(input.disputeStatus!=='clear')holds.push('CONTRACT_DISPUTE_OR_CLAIM');
 if(input.buyerPaymentSupport==='verified'&&input.providerCapacityEvidence==='verified'&&input.performanceEvidence==='verified'){
   // Confidence factors are policy haircuts, not probabilities or guarantees.
 } else holds.push('EVIDENCE_GATE_FAILED');
 const performanceFactor=performanceBps<buyerSupportBps?performanceBps:buyerSupportBps;
 const capacityValue=unearned*capacityBps/BPS;
 const supportedValue=capacityValue*performanceFactor/BPS;
 const buyerSupported=supportedValue*buyerSupportBps/BPS;
 const afterDispute=buyerSupported*(BPS-disputeReserveBps)/BPS;
 const cap=afterDispute*maxAdvanceBps/BPS;
 const eligible=holds.length===0;
 const result={contractId:input.contractId,tenantId:input.tenantId,currency:input.currency.toUpperCase(),grossContractValueMinor:gross.toString(),deliveredValueMinor:(delivered*price).toString(),unearnedContractValueMinor:unearned.toString(),eligibleAdvanceCeilingMinor:eligible?cap.toString():'0',futureUtilityUnitsAvailable:eligible?(contracted-delivered).toString():'0',status:eligible?'ELIGIBLE_FOR_HUMAN_UNDERWRITING':'HOLD',holdReasons:holds,calculation:{policyId:p.id,policyVersion:p.version,capacityFactorBps:capacityBps.toString(),performanceFactorBps:performanceFactor.toString(),buyerSupportFactorBps:buyerSupportBps.toString(),disputeReserveBps:disputeReserveBps.toString(),maxAdvanceBps:maxAdvanceBps.toString()},sourceEvidenceRefs:[...input.sourceEvidenceRefs],boundary:'An underwriting ceiling for review only. Not cash, a deposit, legal collateral, a token, a credit approval, a market price forecast or a guarantee of future delivery. Contract enforceability, assignment, insolvency remoteness, counterparty credit, tax, licensing and accounting treatment require independent review.'};
 result.assessmentFingerprint=hash(result);return result;
}
function calculateUtilityDelivery({contractedUnits,deliveredUnits,acceptedUnits,disputedUnits='0'}){
 const c=integer(contractedUnits,'contracted_units',{min:1n}),d=integer(deliveredUnits,'delivered_units'),a=integer(acceptedUnits,'accepted_units'),q=integer(disputedUnits,'disputed_units');
 if(d>c||a>d||q>d-a)fail('invalid_delivery_reconciliation');
 return {contractedUnits:c.toString(),deliveredUnits:d.toString(),acceptedUnits:a.toString(),disputedUnits:q.toString(),remainingUnits:(c-d).toString(),acceptedFraction:{numerator:a.toString(),denominator:c.toString()},status:q>0n?'PARTIAL_DISPUTE':d===c&&a===c?'FULFILLED':d>0n?'PARTIAL_DELIVERY':'NOT_DELIVERED'};
}
module.exports={assessTemporalCapacity,calculateUtilityDelivery};
