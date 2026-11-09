'use strict';
/**
 * Keel Human Card physical-first activation policy.
 * Evidence booleans below must be produced by trusted server-side verifiers,
 * never accepted directly from a browser. This module does not verify chip
 * signatures or issue payment credentials.
 */
const ORDER=['account_verified','physical_card_ordered','physical_card_dispatched','physical_card_delivered_pending_pairing','physical_card_paired','recovery_configured','virtual_channel_eligible','virtual_channel_active'];
const NEXT=new Map(ORDER.slice(0,-1).map((s,i)=>[s,ORDER[i+1]]));
function fail(code){throw new Error(code)}
function advanceHumanCard(state,event){
 if(!ORDER.includes(state))fail('unknown_human_card_state');
 const next=NEXT.get(state);if(!next||event!==next)fail('invalid_physical_first_transition');
 return next;
}
function evaluateVirtualActivation(evidence){
 if(!evidence||typeof evidence!=='object'||Array.isArray(evidence))fail('activation_evidence_required');
 const requirements=[
  ['accountVerified','ACCOUNT_NOT_VERIFIED'],
  ['physicalCardDelivered','PHYSICAL_CARD_NOT_DELIVERED'],
  ['deliveryProofVerified','DELIVERY_PROOF_NOT_VERIFIED'],
  ['physicalCardChallengeVerified','PHYSICAL_CARD_POSSESSION_NOT_PROVEN'],
  ['hardwareKeyAttested','HARDWARE_KEY_NOT_ATTESTED'],
  ['recoveryConfigured','RECOVERY_NOT_CONFIGURED'],
  ['recoveryTestPassed','RECOVERY_TEST_NOT_PASSED'],
  ['activeMandate','ACTIVE_MANDATE_REQUIRED'],
  ['trustedFundingSource','TRUSTED_FUNDING_SOURCE_REQUIRED']
 ];
 const missing=requirements.filter(([k])=>evidence[k]!==true).map(([,reason])=>reason);
 if(missing.length)return {status:'LOCKED',virtualChannel:'DISABLED',missing};
 if(evidence.issuerProvisioned!==true)return {status:'ELIGIBLE_PENDING_ISSUER',virtualChannel:'NOT_ISSUED',missing:[],note:'Physical-first user activation is complete; a usable payment credential still requires an authorised issuer.'};
 return {status:'ACTIVE',virtualChannel:'PARTNER_ISSUED',missing:[],note:'Issuer has provisioned the virtual payment credential. Keel remains the user-authority and policy control plane.'};
}
function assertNoPrivateKeyMaterial(record){
 if(!record||typeof record!=='object')fail('card_record_required');
 const forbidden=['privateKey','seedPhrase','mnemonic','cvv','cvc','pin','pan','fullCardNumber'];
 for(const key of forbidden)if(record[key]!==undefined&&record[key]!==null)fail('prohibited_secret_material_'+key);
 return true;
}
function evaluateHumanAuthority(action,mandate){
 if(!mandate||mandate.status!=='active')return {decision:'HOLD',reason:'ACTIVE_MANDATE_REQUIRED'};
 if(action.actorType==='ai_agent'&&action.userPresenceRequired===true&&action.userPresenceVerified!==true)return {decision:'HOLD',reason:'HUMAN_PRESENCE_REQUIRED'};
 if(action.amountMinor!==undefined&&(!/^\d+$/.test(String(action.amountMinor))||BigInt(action.amountMinor)<=0n))return {decision:'DENY',reason:'INVALID_AMOUNT_MINOR_UNITS'};
 if(action.currency&&mandate.currency&&action.currency!==mandate.currency)return {decision:'DENY',reason:'CURRENCY_MISMATCH'};
 if(action.amountMinor!==undefined&&mandate.maxSingleAmountMinor!==undefined&&BigInt(action.amountMinor)>BigInt(mandate.maxSingleAmountMinor))return {decision:'DENY',reason:'MANDATE_SINGLE_LIMIT_EXCEEDED'};
 return {decision:'ELIGIBLE_FOR_POLICY_EVALUATION',reason:'NO_EXECUTION_AUTHORIZED'};
}
module.exports={ORDER,advanceHumanCard,evaluateVirtualActivation,assertNoPrivateKeyMaterial,evaluateHumanAuthority};
