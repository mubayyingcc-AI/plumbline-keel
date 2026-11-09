'use strict';
const crypto=require('node:crypto');
const {canonical}=require('./authority-chain');
const BPS=10000n;
function fail(code){throw Object.assign(new Error(code),{code});}
function units(v,name,{min=0n,max=10n**78n}={}){if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(v))fail(name+'_must_be_integer_string');const n=BigInt(v);if(n<min||n>max)fail(name+'_out_of_range');return n;}
function rate(v,name){return units(v,name,{max:BPS});}
function digest(x){return crypto.createHash('sha256').update(canonical(x)).digest('hex');}
function createForwardFacility(x){
 if(!x||typeof x!=='object')fail('facility_required');
 for(const k of ['facilityId','tenantId','buyerRef','providerRef','contractRef','currency','unit','contractedUnits','unitPriceMinor','advanceMinor','buyerCashPrefundMinor','collateralValueMinor','collateralHaircutBps','sourceEvidenceRefs','policyId','policyVersion'])if(x[k]===undefined||x[k]===null)fail('missing_'+k);
 for(const k of ['facilityId','tenantId','buyerRef','providerRef','contractRef','currency','unit','policyId','policyVersion'])if(typeof x[k]!=='string'||!x[k].trim())fail('invalid_'+k);
 const contracted=units(x.contractedUnits,'contracted_units',{min:1n}),price=units(x.unitPriceMinor,'unit_price_minor',{min:1n}),advance=units(x.advanceMinor,'advance_minor'),prefund=units(x.buyerCashPrefundMinor,'buyer_cash_prefund_minor'),collateral=units(x.collateralValueMinor,'collateral_value_minor'),haircut=rate(x.collateralHaircutBps,'collateral_haircut_bps');
 if(!Array.isArray(x.sourceEvidenceRefs)||!x.sourceEvidenceRefs.length||x.sourceEvidenceRefs.some(v=>typeof v!=='string'||!v.trim()))fail('source_evidence_required');
 const contract=contracted*price,netCollateral=collateral*(BPS-haircut)/BPS;
 if(advance>contract)fail('advance_exceeds_contract_value');
 if(advance>netCollateral)fail('advance_exceeds_haircut_adjusted_collateral');
 if(prefund>contract)fail('prefund_exceeds_contract_value');
 const facility={facilityId:x.facilityId,tenantId:x.tenantId,buyerRef:x.buyerRef,providerRef:x.providerRef,contractRef:x.contractRef,currency:x.currency.toUpperCase(),unit:x.unit,contractedUnits:contracted.toString(),unitPriceMinor:price.toString(),grossContractValueMinor:contract.toString(),advanceMinor:advance.toString(),buyerCashPrefundMinor:prefund.toString(),collateralGrossMinor:collateral.toString(),collateralHaircutBps:haircut.toString(),collateralNetMinor:netCollateral.toString(),remainingAdvanceMinor:advance.toString(),acceptedUnits:'0',paidCashMinor:'0',reservedUnits:'0',status:'CONDITIONAL_PENDING_APPROVAL',sourceEvidenceRefs:[...x.sourceEvidenceRefs],policyId:x.policyId,policyVersion:x.policyVersion,mode:'ledger_simulation_no_transfer'};
 facility.fingerprint=digest(facility);return facility;
}
function reserveCapacity(f,amount,capacityEvidence){
 const q=units(amount,'reservation_units',{min:1n}),already=units(f.reservedUnits,'reserved_units'),accepted=units(f.acceptedUnits,'accepted_units'),total=units(f.contractedUnits,'contracted_units');
 if(capacityEvidence!=='verified')fail('provider_capacity_not_verified');
 if(already+accepted+q>total)fail('reservation_exceeds_unallocated_contract_units');
 const next={...f,reservedUnits:(already+q).toString(),status:'CAPACITY_RESERVED'};next.fingerprint=digest(next);return next;
}
function acceptDelivery(f,{deliveredUnits,acceptedUnits,disputedUnits='0',meteringEvidence,customerAcceptance}){
 const delivered=units(deliveredUnits,'delivered_units'),accepted=units(acceptedUnits,'accepted_units'),disputed=units(disputedUnits,'disputed_units');
 if(meteringEvidence!=='verified')fail('metering_evidence_not_verified');
 if(customerAcceptance!=='accepted')fail('customer_acceptance_not_confirmed');
 if(accepted+disputed>delivered)fail('accepted_and_disputed_exceed_delivery');
 const prior=units(f.acceptedUnits,'accepted_units'),contract=units(f.contractedUnits,'contracted_units');
 if(prior+delivered>contract)fail('delivery_exceeds_contract');
 const reserved=units(f.reservedUnits,'reserved_units');
 if(delivered>reserved)fail('delivery_exceeds_reserved_capacity');
 const next={...f,acceptedUnits:(prior+accepted).toString(),reservedUnits:(reserved-delivered).toString(),status:disputed>0n?'DELIVERY_PARTIALLY_DISPUTED':prior+accepted===contract?'DELIVERY_COMPLETE':'DELIVERY_PARTIAL'};
 next.fingerprint=digest(next);return next;
}
function applyClearedBuyerCash(f,{paymentId,amountMinor,bankSettlementEvidence,paymentStatus}){
 if(typeof paymentId!=='string'||!paymentId.trim())fail('payment_id_required');
 if(paymentStatus!=='settled'||bankSettlementEvidence!=='verified')fail('buyer_cash_not_cleared');
 const amount=units(amountMinor,'payment_amount_minor',{min:1n}),prior=units(f.paidCashMinor,'paid_cash_minor'),gross=units(f.grossContractValueMinor,'gross_contract_value_minor');
 if(prior+amount>gross)fail('buyer_cash_exceeds_contract_value');
 const next={...f,paidCashMinor:(prior+amount).toString(),lastPaymentRef:paymentId,status:'BUYER_CASH_RECONCILED'};
 next.fingerprint=digest(next);return next;
}
function allocateCashToAdvance(f,{amountMinor,allocationEvidence}){
 if(allocationEvidence!=='dual_controlled')fail('cash_allocation_requires_dual_control');
 if(allocationEvidence!=='dual_controlled')fail('cash_allocation_requires_dual_control');
 const amount=units(amountMinor,'allocation_amount_minor',{min:1n}),paid=units(f.paidCashMinor,'paid_cash_minor'),advance=units(f.remainingAdvanceMinor,'remaining_advance_minor');
 if(amount>paid)fail('allocation_exceeds_cleared_cash');
 if(amount>advance)fail('allocation_exceeds_outstanding_advance');
 const next={...f,paidCashMinor:(paid-amount).toString(),remainingAdvanceMinor:(advance-amount).toString(),status:advance===amount?'ADVANCE_REPAID':'ADVANCE_PARTIALLY_REPAID'};
 next.fingerprint=digest(next);return next;
}
function facilityExposure(f){
 const contracted=units(f.contractedUnits,'contracted_units'),accepted=units(f.acceptedUnits,'accepted_units'),reserved=units(f.reservedUnits,'reserved_units'),advance=units(f.remainingAdvanceMinor,'remaining_advance_minor'),collateral=units(f.collateralNetMinor,'collateral_net_minor');
 return {unacceptedUnits:(contracted-accepted).toString(),reservedUnits:reserved.toString(),remainingAdvanceMinor:advance.toString(),haircutAdjustedCollateralMinor:collateral.toString(),collateralCoverageBps:advance===0n?'infinite':(collateral*BPS/advance).toString(),shortfallMinor:advance>collateral?(advance-collateral).toString():'0',warning:'Coverage compares stated haircut-adjusted collateral value with the remaining advance. It does not establish title, enforceability, priority, liquidity, liquidation value or recoverability.'};
}
module.exports={createForwardFacility,reserveCapacity,acceptDelivery,applyClearedBuyerCash,allocateCashToAdvance,facilityExposure};
