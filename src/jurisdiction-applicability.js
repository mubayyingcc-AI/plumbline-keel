'use strict';
const crypto=require('node:crypto');
const LEGAL_STATUSES=new Set(['law','regulation','supervisory_instruction','government_policy','supervisory_guidance','international_standard','industry_standard','institution_policy','contractual_obligation']);
function fail(code){const e=new Error(code);e.code=code;throw e;}
function str(v,k,max=200){if(typeof v!=='string'||!v.trim()||v.length>max)fail(k+'_invalid');return v.trim();}
function date(v){if(typeof v!=='string'||!/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.test(v)||Number.isNaN(Date.parse(v+'T00:00:00Z')))fail('date_invalid');return v;}
function validateInstrument(x){
 if(!x||typeof x!=='object')fail('instrument_required');
 const legalStatus=str(x.legalStatus,'legal_status');if(!LEGAL_STATUSES.has(legalStatus))fail('legal_status_invalid');
 const s=x.scope||{};for(const k of ['institutionTypes','activities','dataCategories'])if(!Array.isArray(s[k]))fail('scope_invalid');
 const validFrom=date(x.validFrom),validTo=x.validTo==null?null:date(x.validTo);if(validTo&&validTo<validFrom)fail('date_range_invalid');
 return Object.freeze({id:str(x.id,'instrument_id'),jurisdiction:str(x.jurisdiction,'jurisdiction',12).toUpperCase(),subJurisdiction:x.subJurisdiction||null,authority:str(x.authority,'authority'),title:str(x.title,'title'),legalStatus,sourceUrl:str(x.sourceUrl,'source_url',1000),sourceVersion:str(x.sourceVersion,'source_version',80),validFrom,validTo,scope:s,reviewState:x.reviewState||'research_pending',applicabilityNote:x.applicabilityNote||'Legal review required'});
}
function evaluateApplicability(instruments,c){
 if(!c||typeof c!=='object')fail('institution_context_required');
 const jurisdiction=str(c.jurisdiction,'jurisdiction',12).toUpperCase(),institutionType=str(c.institutionType,'institution_type'),activity=str(c.activity,'activity'),dataCategory=str(c.dataCategory,'data_category'),asOf=date(c.asOf),legalEntityId=str(c.legalEntityId,'legal_entity_id');
 return instruments.map(validateInstrument).filter(i=>{
  const s=i.scope;const hit=(arr,v)=>arr.length===0||arr.includes('*')||arr.includes(v);
  return i.jurisdiction===jurisdiction&&(!i.subJurisdiction||i.subJurisdiction===c.subJurisdiction)&&i.validFrom<=asOf&&(!i.validTo||asOf<=i.validTo)&&hit(s.institutionTypes,institutionType)&&hit(s.activities,activity)&&hit(s.dataCategories,dataCategory)&&(!(s.licenceTypes||[]).length||(s.licenceTypes||[]).includes(c.licenceType));
 }).map(i=>({instrumentId:i.id,sourceVersion:i.sourceVersion,legalStatus:i.legalStatus,reviewState:i.reviewState,applicability:'CANDIDATE_REQUIRES_HUMAN_REVIEW',reason:i.applicabilityNote,legalEntityId,jurisdiction,asOf,requiresApproval:true}));
}
function createKRAR(x){
 if(!x||typeof x!=='object')fail('krar_required');const status=x.status||'DRAFT';
 if(!['DRAFT','PENDING_REVIEW','APPROVED','REJECTED','SUPERSEDED'].includes(status))fail('krar_status_invalid');
 if(status==='APPROVED'&&(!x.approverId||!x.approvedAt||!x.approvalEvidenceRef))fail('krar_approval_evidence_required');
 const body={schemaVersion:'keel-regulatory-applicability-record/1.0',recordId:str(x.recordId,'record_id'),legalEntityId:str(x.legalEntityId,'legal_entity_id'),jurisdiction:str(x.jurisdiction,'jurisdiction',12).toUpperCase(),instrumentId:str(x.instrumentId,'instrument_id'),sourceVersion:str(x.sourceVersion,'source_version'),activities:x.activities||[],dataCategories:x.dataCategories||[],applicabilityReasoning:str(x.applicabilityReasoning,'reasoning',3000),unresolvedQuestions:x.unresolvedQuestions||[],controlIds:x.controlIds||[],evidenceRefs:x.evidenceRefs||[],reviewerId:x.reviewerId||null,status,approverId:x.approverId||null,approvedAt:x.approvedAt||null,approvalEvidenceRef:x.approvalEvidenceRef||null,reviewDueAt:x.reviewDueAt||null,supersedes:x.supersedes||null};
 return Object.freeze({...body,fingerprint:crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')});
}
module.exports={LEGAL_STATUSES,validateInstrument,evaluateApplicability,createKRAR};
