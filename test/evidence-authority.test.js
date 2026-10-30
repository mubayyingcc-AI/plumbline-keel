'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizePrincipal,normalizeDelegation,approvalDecision,exportManifest}=require('../src/evidence-authority');
test('principal identity requires a valid institutional email',()=>{assert.throws(()=>normalizePrincipal({displayName:'Reviewer',email:'bad'}),/email must be valid/);assert.equal(normalizePrincipal({displayName:'Reviewer One',email:'R@EXAMPLE.COM'}).email,'r@example.com');});
test('delegation rejects self grant and bounds expiry',()=>{assert.throws(()=>normalizeDelegation({granteePrincipalId:'p1',scopes:['docket:approve'],expiresAt:new Date(Date.now()+86400000).toISOString()},'p1'),/self_delegation/);assert.throws(()=>normalizeDelegation({granteePrincipalId:'p2',scopes:['docket:approve'],expiresAt:new Date(Date.now()+120*86400000).toISOString()},'p1'),/within the next 90 days/);});
test('approval decisions require rationale',()=>{assert.throws(()=>approvalDecision({decision:'approve'}),/rationale/);assert.equal(approvalDecision({decision:'reject',rationale:'Evidence conflict'}).decision,'reject');});
test('evidence export includes explicit limitations and fingerprint',()=>{const x=exportManifest({tenantId:'t1',docket:{id:'d1'},chainVerification:{valid:true}});assert.match(x.manifestFingerprint,/^[a-f0-9]{64}$/);assert.ok(x.limitations.length>=3);});
