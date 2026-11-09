'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),k=require('../src/human-card');
test('physical-first lifecycle cannot skip receipt, pairing or recovery',()=>{
 assert.equal(k.advanceHumanCard('account_verified','physical_card_ordered'),'physical_card_ordered');
 assert.throws(()=>k.advanceHumanCard('account_verified','virtual_channel_active'),/invalid_physical_first_transition/);
 assert.throws(()=>k.advanceHumanCard('physical_card_dispatched','virtual_channel_eligible'),/invalid_physical_first_transition/);
});
test('virtual activation remains locked until physical delivery, pairing, hardware proof and recovery',()=>{
 const e={accountVerified:true,physicalCardDelivered:false,deliveryProofVerified:false,physicalCardChallengeVerified:false,hardwareKeyAttested:false,recoveryConfigured:false,recoveryTestPassed:false,activeMandate:true,trustedFundingSource:true,issuerProvisioned:true};
 assert.equal(k.evaluateVirtualActivation(e).status,'LOCKED');
 e.physicalCardDelivered=true;e.deliveryProofVerified=true;e.physicalCardChallengeVerified=true;e.hardwareKeyAttested=true;e.recoveryConfigured=true;e.recoveryTestPassed=true;
 assert.equal(k.evaluateVirtualActivation(e).status,'ACTIVE');
});
test('physical activation does not create virtual payment credentials without issuer',()=>{
 const e={accountVerified:true,physicalCardDelivered:true,deliveryProofVerified:true,physicalCardChallengeVerified:true,hardwareKeyAttested:true,recoveryConfigured:true,recoveryTestPassed:true,activeMandate:true,trustedFundingSource:true,issuerProvisioned:false};
 assert.equal(k.evaluateVirtualActivation(e).status,'ELIGIBLE_PENDING_ISSUER');
 assert.equal(k.evaluateVirtualActivation(e).virtualChannel,'NOT_ISSUED');
});
test('Keel records never accept private keys, seed phrases or card secrets',()=>{
 for(const field of ['privateKey','seedPhrase','mnemonic','cvv','pin','pan','fullCardNumber'])assert.throws(()=>k.assertNoPrivateKeyMaterial({cardId:'c', [field]:'secret'}),/prohibited_secret_material/);
 assert.equal(k.assertNoPrivateKeyMaterial({cardId:'c',publicKey:'public',keyFingerprint:'abc'}),true);
});
test('AI agents cannot bypass required human presence and mandate limits',()=>{
 const mandate={status:'active',currency:'USD',maxSingleAmountMinor:'10000'};
 assert.deepEqual(k.evaluateHumanAuthority({actorType:'ai_agent',userPresenceRequired:true,userPresenceVerified:false,amountMinor:'100',currency:'USD'},mandate),{decision:'HOLD',reason:'HUMAN_PRESENCE_REQUIRED'});
 assert.equal(k.evaluateHumanAuthority({amountMinor:'10001',currency:'USD'},mandate).decision,'DENY');
 assert.equal(k.evaluateHumanAuthority({amountMinor:'500',currency:'USD'},mandate).decision,'ELIGIBLE_FOR_POLICY_EVALUATION');
});
