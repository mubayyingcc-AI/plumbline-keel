'use strict';
const crypto=require('node:crypto');
const {canonical}=require('./authority-chain');
const hash=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
const str=(v,n,max=240)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(n+'_required');return v.trim();};
const arr=(v,n)=>{if(!Array.isArray(v)||!v.length)throw Error(n+'_required');return [...new Set(v.map(x=>str(x,n,300)))];};
const OBLIGATION_TYPES=new Set(['law','harmonised_standard','standard','guidance','contract','internal_policy']);
const CONTROL_STATES=new Set(['proposed','approved','implemented','operating','ineffective','suspended','retired']);
const EVIDENCE_STATES=new Set(['self_asserted','source_authenticated','independently_verified','rejected']);
const FINDING_SEVERITIES=new Set(['low','moderate','high','critical']);
function normalizeObligation(x){
 if(!x||typeof x!=='object'||Array.isArray(x))throw Error('obligation_required');
 const type=str(x.sourceType,'source_type',40);if(!OBLIGATION_TYPES.has(type))throw Error('unsupported_source_type');
 const out={obligationId:str(x.obligationId,'obligation_id',120),sourceId:str(x.sourceId,'source_id',120),sourceVersion:str(x.sourceVersion,'source_version',80),sourceType:type,jurisdiction:str(x.jurisdiction,'jurisdiction',80),instrument:str(x.instrument,'instrument',180),locator:str(x.locator,'locator',180),title:str(x.title,'title',300),regulatedRole:str(x.regulatedRole,'regulated_role',80),effectiveFrom:str(x.effectiveFrom,'effective_from',50),effectiveTo:x.effectiveTo||null,applicability:x.applicability&&typeof x.applicability==='object'&&!Array.isArray(x.applicability)?x.applicability:{},evidenceExpectations:arr(x.evidenceExpectations,'evidence_expectations'),legalReviewer:x.legalReviewer?str(x.legalReviewer,'legal_reviewer',120):null};
 if(!Number.isFinite(Date.parse(out.effectiveFrom))||(out.effectiveTo&&!Number.isFinite(Date.parse(out.effectiveTo))))throw Error('invalid_obligation_dates');
 if(out.effectiveTo&&Date.parse(out.effectiveTo)<=Date.parse(out.effectiveFrom))throw Error('invalid_obligation_period');
 out.versionFingerprint=hash(out);return out;
}
function evaluateApplicability(obligation,context,asOf=new Date()){
 if(!obligation||!context||typeof context!=='object')throw Error('applicability_inputs_required');
 const date=asOf instanceof Date?asOf:new Date(asOf);if(!Number.isFinite(date.getTime()))throw Error('invalid_assessment_date');
 const reasons=[],a=obligation.applicability||{};
 if(date.getTime()<Date.parse(obligation.effectiveFrom))reasons.push('NOT_YET_EFFECTIVE');
 if(obligation.effectiveTo&&date.getTime()>=Date.parse(obligation.effectiveTo))reasons.push('NO_LONGER_EFFECTIVE');
 for(const k of ['jurisdiction','regulatedRole','systemType','riskClass','legalEntityType'])if(a[k]&&context[k]!==a[k])reasons.push('SCOPE_MISMATCH_'+k.toUpperCase());
 if(Array.isArray(a.intendedPurposes)&&a.intendedPurposes.length&&!a.intendedPurposes.includes(context.intendedPurpose))reasons.push('INTENDED_PURPOSE_OUT_OF_SCOPE');
 const result={obligationId:obligation.obligationId,obligationFingerprint:obligation.versionFingerprint,asOf:date.toISOString(),applicable:reasons.length===0,reasons,contextFingerprint:hash(context),decisionRequiresHumanApproval:true};
 result.decisionFingerprint=hash(result);return result;
}
function normalizeControl(x){
 if(!x||typeof x!=='object'||Array.isArray(x))throw Error('control_required');
 const state=str(x.state,'control_state',30);if(!CONTROL_STATES.has(state))throw Error('invalid_control_state');
 const out={controlId:str(x.controlId,'control_id',120),version:str(x.version,'control_version',80),title:str(x.title,'control_title',300),description:str(x.description,'control_description',2000),ownerPrincipalId:str(x.ownerPrincipalId,'owner_principal_id',120),operatorPrincipalId:x.operatorPrincipalId||null,frequency:str(x.frequency,'control_frequency',80),state,designAdequacy:x.designAdequacy||'not_assessed',effectiveness:x.effectiveness||'not_tested',testIds:Array.isArray(x.testIds)?[...new Set(x.testIds.map(v=>str(v,'test_id',120)))]:[],dependencies:Array.isArray(x.dependencies)?[...new Set(x.dependencies.map(v=>str(v,'dependency',120)))]:[],approvedBy:x.approvedBy||null,exception:x.exception||null};
 if(!['adequate','inadequate','not_assessed'].includes(out.designAdequacy))throw Error('invalid_design_adequacy');
 if(!['effective','ineffective','not_tested'].includes(out.effectiveness))throw Error('invalid_control_effectiveness');
 if(out.exception&&(!out.exception.approver||!out.exception.expiresAt||!Number.isFinite(Date.parse(out.exception.expiresAt))))throw Error('exception_requires_approver_and_expiry');
 out.controlFingerprint=hash(out);return out;
}
function normalizeEvidence(x){
 if(!x||typeof x!=='object'||Array.isArray(x))throw Error('evidence_required');
 const state=str(x.verificationState,'verification_state',40);if(!EVIDENCE_STATES.has(state))throw Error('invalid_evidence_verification_state');
 const observedAt=str(x.observedAt,'observed_at',50),validUntil=x.validUntil||null;
 if(!Number.isFinite(Date.parse(observedAt))||(validUntil&&!Number.isFinite(Date.parse(validUntil))))throw Error('invalid_evidence_dates');
 const out={evidenceId:str(x.evidenceId,'evidence_id',120),version:str(x.version||'1','evidence_version',80),evidenceType:str(x.evidenceType,'evidence_type',80),sourceRef:str(x.sourceRef,'source_ref',500),sourceIdentity:x.sourceIdentity||null,collectionMethod:str(x.collectionMethod,'collection_method',100),observedAt:new Date(observedAt).toISOString(),validUntil:validUntil?new Date(validUntil).toISOString():null,verificationState:state,integrityFingerprint:x.integrityFingerprint||null,reviewedBy:x.reviewedBy||null,classification:x.classification||'confidential'};
 if(out.integrityFingerprint&&!/^[a-f0-9]{64}$/i.test(out.integrityFingerprint))throw Error('invalid_integrity_fingerprint');
 out.evidenceFingerprint=hash(out);return out;
}
function evaluateCoverage({obligations,controls,mappings,evidenceLinks,now=new Date()}){
 if(!Array.isArray(obligations)||!Array.isArray(controls)||!Array.isArray(mappings)||!Array.isArray(evidenceLinks))throw Error('coverage_collections_required');
 const controlMap=new Map(controls.map(c=>[c.controlId,c])),obMap=new Map(obligations.map(o=>[o.obligationId,o])),evidenceMap=new Map(evidenceLinks.map(e=>[e.evidenceId,e]));
 const findings=[],coverage=[];
 for(const o of obligations){
  const links=mappings.filter(m=>m.obligationId===o.obligationId),reasons=[];
  if(!links.length)reasons.push('NO_CONTROL_MAPPING');
  for(const link of links){
   const c=controlMap.get(link.controlId);
   if(!c){reasons.push('MAPPED_CONTROL_NOT_FOUND');continue;}
   if(!c.ownerPrincipalId)reasons.push('CONTROL_OWNER_MISSING');
   if(!['implemented','operating'].includes(c.state))reasons.push('CONTROL_NOT_IMPLEMENTED');
   if(c.designAdequacy!=='adequate')reasons.push('CONTROL_DESIGN_NOT_ASSESSED_ADEQUATE');
   if(c.effectiveness!=='effective')reasons.push('CONTROL_EFFECTIVENESS_NOT_PROVEN');
   const ev=(link.evidenceIds||[]).map(id=>evidenceMap.get(id)).filter(Boolean);
   if(!ev.length)reasons.push('EVIDENCE_MISSING');
   for(const e of ev){
    if(e.verificationState!=='independently_verified'&&e.verificationState!=='source_authenticated')reasons.push('EVIDENCE_NOT_AUTHENTICATED');
    if(e.validUntil&&Date.parse(e.validUntil)<=now.getTime())reasons.push('EVIDENCE_EXPIRED');
    if(Date.parse(e.observedAt)>now.getTime()+60000)reasons.push('EVIDENCE_FROM_FUTURE');
   }
  }
  const unique=[...new Set(reasons)],status=unique.length?'gap':'evidence_linked_control_coverage';
  coverage.push({obligationId:o.obligationId,status,reasons:unique,controlIds:links.map(x=>x.controlId)});
  for(const reason of unique)findings.push({findingId:hash({obligationId:o.obligationId,reason}).slice(0,24),obligationId:o.obligationId,code:reason,severity:['CONTROL_NOT_IMPLEMENTED','EVIDENCE_MISSING','EVIDENCE_NOT_AUTHENTICATED'].includes(reason)?'high':'moderate',status:'open',ruleVersion:'regulatory-coverage-1.0'});
 }
 const result={schemaVersion:'keel-regulatory-coverage-1.0',assessedAt:now.toISOString(),coverage,findings,summary:{obligations:obligations.length,covered:coverage.filter(x=>x.status==='evidence_linked_control_coverage').length,gaps:coverage.filter(x=>x.status==='gap').length},boundary:'Evidence-linked coverage assessment only. Not legal advice, certification, conformity assessment or a declaration of compliance.'};
 result.assessmentFingerprint=hash(result);return result;
}
function createConformityDocket(input){
 if(!input||typeof input!=='object'||!input.scope||!input.coverage)throw Error('docket_scope_and_coverage_required');
 const state=input.state||'DRAFT';if(!['DRAFT','IN_REVIEW','ACCEPTED_WITH_GAPS','READY_FOR_EXTERNAL_REVIEW','SUPERSEDED'].includes(state))throw Error('invalid_docket_state');
 const snapshot={schemaVersion:'keel-conformity-docket-1.0',docketId:str(input.docketId,'docket_id',120),tenantId:str(input.tenantId,'tenant_id',120),createdAt:(input.createdAt?new Date(input.createdAt):new Date()).toISOString(),scope:input.scope,obligationVersions:input.obligationVersions||[],mappings:input.mappings||[],coverage:input.coverage,findings:input.findings||input.coverage.findings||[],exceptions:input.exceptions||[],reviewerApprovals:input.reviewerApprovals||[],limitations:input.limitations||[],state,externalReviewReady:state==='READY_FOR_EXTERNAL_REVIEW'};
 snapshot.manifestFingerprint=hash(snapshot);snapshot.declaration='This dossier is an evidence package for review. It is not a certificate, legal opinion or automatic declaration of conformity.';return snapshot;
}
function assessRegulatoryChange({oldVersion,newVersion,obligations,mappings,controls}){
 if(!oldVersion||!newVersion||!Array.isArray(obligations)||!Array.isArray(mappings)||!Array.isArray(controls))throw Error('change_impact_inputs_required');
 const changed=obligations.filter(o=>o.sourceVersion===oldVersion),affectedIds=new Set(changed.map(o=>o.obligationId));
 const impactedMappings=mappings.filter(m=>affectedIds.has(m.obligationId));
 const impactedControls=[...new Set(impactedMappings.map(m=>m.controlId))].map(id=>controls.find(c=>c.controlId===id)).filter(Boolean);
 const result={oldVersion,newVersion,affectedObligationIds:[...affectedIds],affectedControlIds:impactedControls.map(c=>c.controlId),affectedMappingCount:impactedMappings.length,requiresHumanLegalReview:true,requiresControlOwnerReview:true,automaticPolicyChange:false};
 result.impactFingerprint=hash(result);return result;
}
module.exports={OBLIGATION_TYPES,CONTROL_STATES,EVIDENCE_STATES,normalizeObligation,evaluateApplicability,normalizeControl,normalizeEvidence,evaluateCoverage,createConformityDocket,assessRegulatoryChange,hash};
