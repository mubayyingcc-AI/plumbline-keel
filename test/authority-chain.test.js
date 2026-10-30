'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {eventDigest,verifyChain}=require('../src/authority-chain');
function row(sequence,previousFingerprint,eventType='DOCKET_CREATED'){
 const e={tenantId:'tenant-a',sequence,previousFingerprint,eventId:'event-'+sequence,eventType,subjectId:'subject-'+sequence,actorKeyId:'key-1',actorRole:'reviewer',payload:{decision:'ALLOW',sequence}};
 return {...e,eventFingerprint:eventDigest(e)};
}
test('authority event chain verifies sequence and fingerprints',()=>{
 const a=row(1,null),b=row(2,a.eventFingerprint);
 assert.deepEqual(verifyChain([a,b]),{valid:true,eventCount:2,headFingerprint:b.eventFingerprint});
});
test('authority event chain detects altered event payload',()=>{
 const a=row(1,null),changed={...a,payload:{decision:'HOLD',sequence:1}};
 assert.equal(verifyChain([changed]).reason,'event_fingerprint_mismatch');
});
test('authority event chain detects gaps and reordered events',()=>{
 const a=row(1,null),b=row(3,a.eventFingerprint);
 assert.equal(verifyChain([a,b]).reason,'sequence_gap');
 assert.equal(verifyChain([b,a]).reason,'sequence_gap');
});
test('event digest is independent of object key order',()=>{
 const a={tenantId:'t',sequence:1,previousFingerprint:null,eventId:'e',eventType:'X',subjectId:'s',actorKeyId:'k',actorRole:'reviewer',payload:{b:2,a:1}};
 const b={...a,payload:{a:1,b:2}};
 assert.equal(eventDigest(a),eventDigest(b));
});
