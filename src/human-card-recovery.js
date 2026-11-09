'use strict';
const MIN_DELAY_HOURS=24,MAX_DELAY_HOURS=168,MAX_TRUSTEES=7,MIN_TRUSTEES=2;
function validateRecoveryGroup({ownerPrincipalId,trusteePrincipalIds,threshold,delayHours,verifiedTrustees}){
 if(typeof ownerPrincipalId!=='string'||!ownerPrincipalId.trim())throw new Error('recovery_owner_required');
 if(!Array.isArray(trusteePrincipalIds)||trusteePrincipalIds.length<MIN_TRUSTEES||trusteePrincipalIds.length>MAX_TRUSTEES)throw new Error('recovery_trustee_count_invalid');
 const ids=trusteePrincipalIds.map(x=>String(x));
 if(new Set(ids).size!==ids.length)throw new Error('recovery_trustees_must_be_unique');
 if(ids.includes(ownerPrincipalId))throw new Error('recovery_owner_cannot_be_trustee');
 if(!Number.isInteger(threshold)||threshold<2||threshold>ids.length)throw new Error('recovery_threshold_invalid');
 if(!Number.isInteger(delayHours)||delayHours<MIN_DELAY_HOURS||delayHours>MAX_DELAY_HOURS)throw new Error('recovery_delay_out_of_range');
 if(!Array.isArray(verifiedTrustees)||ids.some(id=>!verifiedTrustees.includes(id)))throw new Error('all_recovery_trustees_must_be_externally_verified');
 return {ownerPrincipalId,trusteePrincipalIds:ids,threshold,delayHours};
}
function evaluateRecoveryApproval({status,ownerPrincipalId,trusteePrincipalId,decision,alreadyApproved,threshold,delayHours}){
 if(status!=='pending')return {accepted:false,status,reason:'RECOVERY_REQUEST_NOT_PENDING'};
 if(!trusteePrincipalId||trusteePrincipalId===ownerPrincipalId)return {accepted:false,status,reason:'INDEPENDENT_TRUSTEE_REQUIRED'};
 if(alreadyApproved)return {accepted:false,status,reason:'TRUSTEE_ALREADY_RESPONDED'};
 if(decision!=='approve'&&decision!=='reject')return {accepted:false,status,reason:'INVALID_RECOVERY_DECISION'};
 if(decision==='reject')return {accepted:true,status:'rejected',reason:'TRUSTEE_REJECTED'};
 if(!Number.isInteger(threshold)||threshold<2||!Number.isInteger(delayHours)||delayHours<MIN_DELAY_HOURS||delayHours>MAX_DELAY_HOURS)throw new Error('recovery_policy_invalid');
 return {accepted:true,status:'pending',reason:'APPROVAL_RECORDED',threshold,delayHours};
}
function finaliseRecovery({status,eligibleAt,now=Date.now()}){
 if(status!=='approved_waiting_period')return {accepted:false,status,reason:'RECOVERY_NOT_APPROVED'};
 const due=Date.parse(eligibleAt);
 if(!Number.isFinite(due)||due>now)return {accepted:false,status,reason:'RECOVERY_DELAY_NOT_ELAPSED'};
 return {accepted:true,status:'replacement_pending',reason:'REPLACEMENT_CARD_REQUIRED'};
}
module.exports={MIN_DELAY_HOURS,MAX_DELAY_HOURS,MAX_TRUSTEES,MIN_TRUSTEES,validateRecoveryGroup,evaluateRecoveryApproval,finaliseRecovery};
