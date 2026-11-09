'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const identity=require('../src/consumer-identity');
const card=require('../src/human-card-provisioning');
const secret='test-webhook-secret-that-is-at-least-32-bytes';
function signed(body,ts=Math.floor(Date.now()/1000)){
 const raw=Buffer.from(JSON.stringify(body));
 const signature=crypto.createHmac('sha256',secret).update(String(ts)+'.').update(raw).digest('hex');
 return {raw,timestamp:String(ts),signature};
}
test('signed identity provider webhook validates HMAC, freshness and raw body binding',()=>{
 const body={provider:'test-idp',eventId:'evt-1',externalSubjectRef:'opaque-subject',externalReference:'case-1',status:'verified',assurance:'high',evidenceHash:'a'.repeat(64),verifiedAt:new Date().toISOString()};
 const s=signed(body);
 const result=identity.verifyProviderWebhook({rawBody:s.raw,timestamp:s.timestamp,signature:s.signature,secret});
 assert.equal(result.bodyHash,crypto.createHash('sha256').update(s.raw).digest('hex'));
 assert.throws(()=>identity.verifyProviderWebhook({rawBody:s.raw,timestamp:s.timestamp,signature:'0'.repeat(64),secret}),/webhook_signature_mismatch/);
 assert.throws(()=>identity.verifyProviderWebhook({rawBody:s.raw,timestamp:String(Number(s.timestamp)-1000),signature:s.signature,secret}),/webhook_timestamp_out_of_range/);
});
test('identity provider events require assurance, opaque references and evidence hashes',()=>{
 const event={provider:'test-idp',eventId:'evt-1',externalSubjectRef:'opaque-subject',externalReference:'case-1',status:'verified',assurance:'high',evidenceHash:'b'.repeat(64),verifiedAt:'2026-11-09T12:00:00.000Z'};
 assert.equal(identity.normalizeProviderIdentityResult(event).status,'verified');
 assert.throws(()=>identity.normalizeProviderIdentityResult({...event,assurance:'low'}),/identity_assurance_insufficient/);
 assert.throws(()=>identity.normalizeProviderIdentityResult({...event,evidenceHash:'not-a-hash'}),/identity_evidence_hash_invalid/);
 assert.throws(()=>identity.normalizeProviderIdentityResult({...event,externalSubjectRef:''}),/identity_provider_externalSubjectRef_invalid/);
});
test('consumer card ordering accepts only supported product and country and explicit terms',()=>{
 assert.deepEqual(card.normalizeOrderRequest({deliveryRegion:'NG',cardProduct:'human-card-standard',acceptedTerms:true}),{deliveryRegion:'NG',cardProduct:'human-card-standard',acceptedTerms:true});
 assert.throws(()=>card.normalizeOrderRequest({deliveryRegion:'NGA',acceptedTerms:true}),/delivery_region_iso_country_required/);
 assert.throws(()=>card.normalizeOrderRequest({deliveryRegion:'NG',acceptedTerms:false}),/card_order_terms_acceptance_required/);
});
test('virtual card is held until physical delivery, pairing, recovery and issuer prerequisites pass',()=>{
 const base={identityVerified:true,physicalCardDelivered:true,physicalCardPaired:true,hardwareAttestationVerified:true,recoveryGroupConfigured:true,recoveryTestPassed:true,accountStatus:'active',issuerProgrammeReady:true,fundingSourceVerified:true,mandateAndSpendPolicyReady:true};
 assert.equal(card.evaluateVirtualEligibility({...base,physicalCardDelivered:false}).eligible,false);
 const pass=card.evaluateVirtualEligibility(base);
 assert.equal(pass.eligible,true);assert.equal(pass.decision,'ELIGIBLE_FOR_ISSUER_REVIEW');
});
test('physical-first lifecycle rejects skipping delivery, pairing or recovery',()=>{
 assert.throws(()=>card.transition({current:'identity_verified',event:'physical_pairing_verified',proof:{pairingEvidenceRef:'proof',deviceKeyFingerprint:'f'.repeat(64)}}),/transition_not_allowed/);
 const delivered=card.transition({current:'delivery_pending_verification',event:'delivery_independently_verified',proof:{deliveryVerifierId:'verifier-1',deliveryEvidenceHash:'a'.repeat(64)}});
 assert.equal(delivered.state,'delivered_pending_pairing');
 assert.throws(()=>card.transition({current:'paired',event:'virtual_eligibility_approved',proof:{eligibilityDecisionRef:'decision'}}),/transition_not_allowed/);
});
test('card lifecycle requires external proof references at every privileged transition',()=>{
 assert.throws(()=>card.transition({current:'identity_pending',event:'identity_verified',proof:{}}),/proof_required/);
 assert.throws(()=>card.transition({current:'issuer_provisioning',event:'issuer_virtual_credential_confirmed',proof:{issuerProgramId:'p'}}),/proof_required/);
});
