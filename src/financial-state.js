'use strict';
const crypto=require('node:crypto');
const {canonical}=require('./authority-chain');
const TYPES=new Set(['cash_account','deposit','collateral_asset','receivable','liability','commitment','restriction','service_credit']);
const EVIDENCE=new Set(['observed','verified','derived','estimated','ai_inferred','simulated']);
const LIFE=new Set(['active','pending','disputed','expired','released','settled']);
const req=(v,n,max=200)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(n+'_required');return v.trim();};
const units=(v,n)=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(v))throw Error(n+'_must_be_integer_units');return v;};
const fingerprint=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
function normalizeFinancialObject(x,now=new Date()){
 if(!x||typeof x!=='object'||Array.isArray(x))throw Error('financial_object_required');
 const objectType=req(x.objectType,'object_type',40);if(!TYPES.has(objectType))throw Error('unsupported_object_type');
 const currencyOrUnit=req(x.currencyOrUnit,'currency_or_unit',20).toUpperCase();if(!/^[A-Z][A-Z0-9_]{1,15}$/.test(currencyOrUnit))throw Error('invalid_currency_or_unit');
 const grossUnits=units(x.grossUnits,'gross_units'),encumberedUnits=x.encumberedUnits==null?null:units(x.encumberedUnits,'encumbered_units');
 if(encumberedUnits!==null&&BigInt(encumberedUnits)>BigInt(grossUnits))throw Error('encumbered_exceeds_gross');
 const evidenceStatus=req(x.evidenceStatus,'evidence_status',30);if(!EVIDENCE.has(evidenceStatus))throw Error('unsupported_evidence_status');
 const lifecycleStatus=req(x.lifecycleStatus||'active','lifecycle_status',30);if(!LIFE.has(lifecycleStatus))throw Error('unsupported_lifecycle_status');
 const observedAt=req(x.observedAt,'observed_at',80),t=Date.parse(observedAt);if(!Number.isFinite(t)||t>now.getTime()+60000)throw Error('invalid_observed_at');
 const encumbranceStatus=req(x.encumbranceStatus||'unknown','encumbrance_status',20);if(!['known','unknown','conflicted'].includes(encumbranceStatus))throw Error('invalid_encumbrance_status');
 const o={objectId:req(x.objectId,'object_id',100),objectType,currencyOrUnit,grossUnits,encumberedUnits,encumbranceStatus,ownerRef:x.ownerRef==null?null:req(x.ownerRef,'owner_ref'),controllerRef:x.controllerRef==null?null:req(x.controllerRef,'controller_ref'),counterpartyRef:x.counterpartyRef==null?null:req(x.counterpartyRef,'counterparty_ref'),sourceRef:req(x.sourceRef,'source_ref',300),externalObjectRef:req(x.externalObjectRef,'external_object_ref',300),observedAt:new Date(t).toISOString(),effectiveAt:x.effectiveAt||null,expiresAt:x.expiresAt||null,evidenceStatus,lifecycleStatus,duplicateOf:x.duplicateOf||null,policyVersion:x.policyVersion||null,relationshipRefs:Array.isArray(x.relationshipRefs)?[...new Set(x.relationshipRefs.map(v=>req(v,'relationship_ref',100)))]:[],metadata:x.metadata&&typeof x.metadata==='object'&&!Array.isArray(x.metadata)?x.metadata:{}};
 if(o.expiresAt&&!Number.isFinite(Date.parse(o.expiresAt)))throw Error('invalid_expires_at');o.objectFingerprint=fingerprint(o);return o;
}
function assessAvailability(o,p={},now=new Date()){
 const age=Number.isSafeInteger(p.maxEvidenceAgeMs)&&p.maxEvidenceAgeMs>=0?p.maxEvidenceAgeMs:86400000,reasons=[];
 if(!['cash_account','deposit','collateral_asset','service_credit'].includes(o.objectType))reasons.push('OBJECT_TYPE_NOT_AVAILABLE_VALUE');
 if(o.lifecycleStatus!=='active')reasons.push('OBJECT_NOT_ACTIVE');
 if(o.evidenceStatus!=='verified')reasons.push('EVIDENCE_NOT_VERIFIED');
 if(o.encumbranceStatus!=='known'||o.encumberedUnits===null)reasons.push('ENCUMBRANCE_NOT_ESTABLISHED');
 if(now.getTime()-Date.parse(o.observedAt)>age)reasons.push('EVIDENCE_STALE');
 if(o.duplicateOf)reasons.push('POTENTIAL_DOUBLE_COUNT');
 if(o.expiresAt&&Date.parse(o.expiresAt)<=now.getTime())reasons.push('OBJECT_EXPIRED');
 return {objectId:o.objectId,currencyOrUnit:o.currencyOrUnit,grossUnits:o.grossUnits,encumberedUnits:o.encumberedUnits,availableUnits:reasons.length?null:(BigInt(o.grossUnits)-BigInt(o.encumberedUnits)).toString(),status:reasons.length?'hold':'eligible_under_declared_policy',reasons,policy:{id:p.id||'keel-default-availability',version:p.version||'1',maxEvidenceAgeMs:age},boundary:'Supplied records and declared policy only; no independent title, custody, lien, registry or legal-priority verification.'};
}
function buildStateSnapshot(objects,p={},now=new Date()){
 if(!Array.isArray(objects))throw Error('financial_objects_array_required');const seen=new Set(),ids=new Set(objects.map(o=>o.objectId));
 for(const o of objects){if(seen.has(o.objectId))throw Error('duplicate_object_id');seen.add(o.objectId);if(o.duplicateOf&&!ids.has(o.duplicateOf))throw Error('duplicate_reference_not_found');}
 const assessed=objects.map(o=>assessAvailability(o,p,now)),totals={};
 for(const o of assessed)if(o.availableUnits!==null)totals[o.currencyOrUnit]=(BigInt(totals[o.currencyOrUnit]||'0')+BigInt(o.availableUnits)).toString();
 return {schemaVersion:'keel-financial-state-1.0',asOf:now.toISOString(),objectCount:objects.length,objects:assessed,summary:{eligibleObjects:assessed.filter(o=>o.availableUnits!==null).length,heldObjects:assessed.filter(o=>o.availableUnits===null).length,totalsByUnit:totals},snapshotFingerprint:fingerprint({objects:objects.map(o=>o.objectFingerprint),policy:p})};
}
module.exports={TYPES,EVIDENCE,LIFE,normalizeFinancialObject,assessAvailability,buildStateSnapshot,fingerprint};
