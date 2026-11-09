'use strict';
const STATES=Object.freeze(['identity_pending','identity_verified','order_submitted','partner_accepted','personalised','dispatched','delivery_pending_verification','delivered_pending_pairing','paired','recovery_configured','recovery_tested','virtual_eligible','issuer_provisioning','virtual_active','suspended','cancelled']);
const TRANSITIONS=Object.freeze({
 identity_pending:['identity_verified','suspended'],
 identity_verified:['order_submitted','suspended'],
 order_submitted:['partner_accepted','cancelled','suspended'],
 partner_accepted:['personalised','cancelled','suspended'],
 personalised:['dispatched','cancelled','suspended'],
 dispatched:['delivery_pending_verification','suspended'],
 delivery_pending_verification:['delivered_pending_pairing','suspended'],
 delivered_pending_pairing:['paired','suspended'],
 paired:['recovery_configured','suspended'],
 recovery_configured:['recovery_tested','suspended'],
 recovery_tested:['virtual_eligible','suspended'],
 virtual_eligible:['issuer_provisioning','suspended'],
 issuer_provisioning:['virtual_active','suspended'],
 virtual_active:['suspended'],
 suspended:['identity_pending','identity_verified','order_submitted','partner_accepted','personalised','dispatched','delivery_pending_verification','delivered_pending_pairing','paired','recovery_configured','recovery_tested','virtual_eligible','issuer_provisioning'],
 cancelled:[]
});
function assertState(s){if(!STATES.includes(s))throw new Error('card_provisioning_state_invalid');}
function transition({current,event,proof}){
 assertState(current);
 const map={
  identity_verified:'identity_verified',order_submitted:'order_submitted',partner_accepted:'partner_accepted',personalised:'personalised',dispatched:'dispatched',delivery_scan_received:'delivery_pending_verification',delivery_independently_verified:'delivered_pending_pairing',physical_pairing_verified:'paired',recovery_group_configured:'recovery_configured',recovery_test_passed:'recovery_tested',virtual_eligibility_approved:'virtual_eligible',issuer_provisioning_requested:'issuer_provisioning',issuer_virtual_credential_confirmed:'virtual_active',suspend:'suspended',cancel:'cancelled'
 };
 const next=map[event];if(!next)throw new Error('card_provisioning_event_invalid');
 if(!TRANSITIONS[current].includes(next))throw new Error('card_provisioning_transition_not_allowed');
 const required={
  identity_verified:['identityVerificationRef','identityProvider'],
  partner_accepted:['partnerOrderRef','partnerId'],
  personalised:['personalisationCertificateRef'],
  dispatched:['shipmentReference','carrierId'],
  delivery_pending_verification:['deliveryEvidenceRef'],
  delivered_pending_pairing:['deliveryVerifierId','deliveryEvidenceHash'],
  paired:['pairingEvidenceRef','deviceKeyFingerprint'],
  recovery_configured:['recoveryGroupRef'],
  recovery_tested:['recoveryTestEvidenceRef'],
  virtual_eligible:['eligibilityDecisionRef'],
  issuer_provisioning:['issuerProgramId','issuerRequestRef'],
  virtual_active:['issuerCredentialReference','issuerConfirmationRef']
 };
 for(const k of required[next]||[])if(!proof||typeof proof[k]!=='string'||!proof[k].trim())throw new Error('card_provisioning_proof_required:'+k);
 if(next==='virtual_eligible'&&current!=='recovery_tested')throw new Error('physical_and_recovery_gates_required');
 if(next==='virtual_active'&&current!=='issuer_provisioning')throw new Error('issuer_confirmation_required');
 return Object.freeze({previousState:current,state:next,event,proof:Object.freeze({...proof})});
}
function evaluateVirtualEligibility(facts){
 const checks=[
 ['identityVerified',facts.identityVerified===true],
 ['physicalCardDelivered',facts.physicalCardDelivered===true],
 ['physicalCardPaired',facts.physicalCardPaired===true],
 ['hardwareAttestationVerified',facts.hardwareAttestationVerified===true],
 ['recoveryGroupConfigured',facts.recoveryGroupConfigured===true],
 ['recoveryTestPassed',facts.recoveryTestPassed===true],
 ['accountNotRestricted',facts.accountStatus==='active'],
 ['issuerProgrammeReady',facts.issuerProgrammeReady===true],
 ['fundingSourceVerified',facts.fundingSourceVerified===true],
 ['mandateAndSpendPolicyReady',facts.mandateAndSpendPolicyReady===true]
 ];
 const failed=checks.filter(([,ok])=>!ok).map(([name])=>name);
 return Object.freeze({eligible:failed.length===0,failedChecks:failed,decision:failed.length===0?'ELIGIBLE_FOR_ISSUER_REVIEW':'HOLD',note:'Eligibility is a prerequisite assessment only; an authorised issuer must independently approve and provision the virtual credential.'});
}
function normalizeOrderRequest(input){
 const region=String(input&&input.deliveryRegion||'').trim().toUpperCase();
 const product=String(input&&input.cardProduct||'human-card-standard').trim();
 if(!/^[A-Z]{2}$/.test(region))throw new Error('delivery_region_iso_country_required');
 if(!['human-card-standard','human-card-accessible'].includes(product))throw new Error('card_product_invalid');
 if(input&&input.acceptedTerms!==true)throw new Error('card_order_terms_acceptance_required');
 return Object.freeze({deliveryRegion:region,cardProduct:product,acceptedTerms:true});
}
module.exports={STATES,TRANSITIONS,transition,evaluateVirtualEligibility,normalizeOrderRequest};
