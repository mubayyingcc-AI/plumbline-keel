'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),r=require('../src/human-card-recovery');
const owner='owner-1',trustees=['t1','t2','t3'];
test('recovery group requires independent verified trustees and a delay',()=>{
 assert.deepEqual(r.validateRecoveryGroup({ownerPrincipalId:owner,trusteePrincipalIds:trustees,threshold:2,delayHours:24,verifiedTrustees:trustees}),{ownerPrincipalId:owner,trusteePrincipalIds:trustees,threshold:2,delayHours:24});
 assert.throws(()=>r.validateRecoveryGroup({ownerPrincipalId:owner,trusteePrincipalIds:['t1'],threshold:1,delayHours:24,verifiedTrustees:['t1']}),/trustee_count_invalid/);
 assert.throws(()=>r.validateRecoveryGroup({ownerPrincipalId:owner,trusteePrincipalIds:[owner,'t2'],threshold:2,delayHours:24,verifiedTrustees:[owner,'t2']}),/owner_cannot_be_trustee/);
 assert.throws(()=>r.validateRecoveryGroup({ownerPrincipalId:owner,trusteePrincipalIds:trustees,threshold:2,delayHours:1,verifiedTrustees:trustees}),/delay_out_of_range/);
 assert.throws(()=>r.validateRecoveryGroup({ownerPrincipalId:owner,trusteePrincipalIds:trustees,threshold:2,delayHours:24,verifiedTrustees:['t1','t2']}),/externally_verified/);
});
test('only an independent trustee can approve a pending recovery once',()=>{
 assert.equal(r.evaluateRecoveryApproval({status:'pending',ownerPrincipalId:owner,trusteePrincipalId:owner,decision:'approve',threshold:2,delayHours:24}).reason,'INDEPENDENT_TRUSTEE_REQUIRED');
 assert.equal(r.evaluateRecoveryApproval({status:'pending',ownerPrincipalId:owner,trusteePrincipalId:'t1',decision:'approve',alreadyApproved:true,threshold:2,delayHours:24}).reason,'TRUSTEE_ALREADY_RESPONDED');
 assert.equal(r.evaluateRecoveryApproval({status:'pending',ownerPrincipalId:owner,trusteePrincipalId:'t1',decision:'approve',threshold:2,delayHours:24}).accepted,true);
});
test('rejection blocks request and approvals cannot be changed after pending state',()=>{
 assert.equal(r.evaluateRecoveryApproval({status:'pending',ownerPrincipalId:owner,trusteePrincipalId:'t1',decision:'reject',threshold:2,delayHours:24}).status,'rejected');
 assert.equal(r.evaluateRecoveryApproval({status:'approved_waiting_period',ownerPrincipalId:owner,trusteePrincipalId:'t2',decision:'approve',threshold:2,delayHours:24}).accepted,false);
});
test('recovery cannot finalise before delay or skip replacement onboarding',()=>{
 assert.equal(r.finaliseRecovery({status:'approved_waiting_period',eligibleAt:new Date(2000).toISOString(),now:1000}).accepted,false);
 assert.deepEqual(r.finaliseRecovery({status:'approved_waiting_period',eligibleAt:new Date(1000).toISOString(),now:1000}),{accepted:true,status:'replacement_pending',reason:'REPLACEMENT_CARD_REQUIRED'});
 assert.equal(r.finaliseRecovery({status:'pending',eligibleAt:new Date(0).toISOString(),now:1000}).accepted,false);
});
