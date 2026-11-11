'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {evaluateAction,detectConsequenceConflicts}=require('../src/authority-action-assurance');
const tenantId='11111111-1111-4111-8111-111111111111',now='2026-11-10T12:00:00.000Z';
const envelope={tenantId,grantorId:'human-1',granteeId:'agent-1',scopes:['initiate'],issuedAt:'2026-11-10T11:00:00Z',expiresAt:'2026-11-10T13:00:00Z',status:'active',maxAmountMinor:'10000',currency:'USD'};
test('valid bounded agent action permitted',()=>assert.equal(evaluateAction({envelope,actorId:'agent-1',tenantId,action:'initiate',amountMinor:'500',currency:'USD',now}).outcome,'PERMIT'));
test('cross-tenant agent action denied',()=>assert.equal(evaluateAction({envelope,actorId:'agent-1',tenantId:'22222222-2222-4222-8222-222222222222',action:'initiate',now}).outcome,'DENY'));
test('over-privileged action denied',()=>assert.ok(evaluateAction({envelope,actorId:'agent-1',tenantId,action:'release',now}).reasonCodes.includes('ACTION_OUTSIDE_DELEGATION')));
test('expired delegation denied',()=>assert.equal(evaluateAction({envelope:{...envelope,expiresAt:'2026-11-10T11:59:00Z'},actorId:'agent-1',tenantId,action:'initiate',now}).outcome,'DENY'));
test('spend above cap denied',()=>assert.ok(evaluateAction({envelope,actorId:'agent-1',tenantId,action:'initiate',amountMinor:'10001',currency:'USD',now}).reasonCodes.includes('AMOUNT_LIMIT_EXCEEDED')));
test('human approval required independently',()=>assert.equal(evaluateAction({envelope:{...envelope,approvalRequired:true,approverId:'human-2'},actorId:'agent-1',tenantId,action:'initiate',now,approvals:[]}).outcome,'REQUIRE_APPROVAL'));
test('dangerous combined capabilities detected',()=>assert.equal(detectConsequenceConflicts([{actorId:'agent-1',resourceId:'acct-1',capabilities:['read_beneficiaries','initiate_payment']}])[0].severity,'critical'));
test('self delegation denied',()=>assert.equal(evaluateAction({envelope:{...envelope,grantorId:'agent-1'},actorId:'agent-1',tenantId,action:'initiate',now}).outcome,'DENY'));

test('toxic capabilities split across grants are still detected',()=>assert.equal(detectConsequenceConflicts([{actorId:'agent-1',resourceId:'acct-1',capabilities:['read_beneficiaries']},{actorId:'agent-1',resourceId:'acct-1',capabilities:['initiate_payment']}]).length,1));
test('invalid delegated amount cap fails closed',()=>assert.equal(evaluateAction({envelope:{...envelope,maxAmountMinor:'not-a-number'},actorId:'agent-1',tenantId,action:'initiate',now}).outcome,'DENY'));

test('provider enqueue dispatch recovery and outcome require explicit authority scopes',()=>{const {ACTIONS}=require('../src/authority-persistence');for(const action of ['provider:instruction:enqueue','provider:instruction:dispatch','provider:instruction:recover_expired','provider:instruction:outcome'])assert.equal(ACTIONS.has(action),true);assert.equal(ACTIONS.has('*'),false);});
