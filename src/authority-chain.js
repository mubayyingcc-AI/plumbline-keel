'use strict';
const crypto=require('node:crypto');
function canonical(value){
  if(value===null||typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
function eventDigest(event){
  return crypto.createHash('sha256').update(canonical({
    tenantId:event.tenantId,sequence:event.sequence,previousFingerprint:event.previousFingerprint||null,
    eventId:event.eventId,eventType:event.eventType,subjectId:event.subjectId,
    actorKeyId:event.actorKeyId,actorRole:event.actorRole,payload:event.payload
  })).digest('hex');
}
function verifyChain(events){
  let previous=null, expected=1;
  for(const event of events){
    if(Number(event.sequence)!==expected) return {valid:false,at:expected,reason:'sequence_gap'};
    if((event.previousFingerprint||null)!==previous) return {valid:false,at:expected,reason:'previous_fingerprint_mismatch'};
    const actual=eventDigest({tenantId:event.tenantId,sequence:Number(event.sequence),previousFingerprint:event.previousFingerprint,eventId:event.eventId,eventType:event.eventType,subjectId:event.subjectId,actorKeyId:event.actorKeyId,actorRole:event.actorRole,payload:event.payload});
    if(actual!==event.eventFingerprint) return {valid:false,at:expected,reason:'event_fingerprint_mismatch'};
    previous=actual; expected++;
  }
  return {valid:true,eventCount:events.length,headFingerprint:previous};
}
module.exports={canonical,eventDigest,verifyChain};
