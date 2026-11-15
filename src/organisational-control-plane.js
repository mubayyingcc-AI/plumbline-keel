'use strict';
const crypto=require('node:crypto');
const {canonical}=require('./authority-chain');
const CAPABILITY_TYPES=new Set(['read','analyse','create','modify','communicate','approve','execute','delete']);
const RISK_TIERS=new Set(['low','medium','high','critical']);
const ID=/^[a-z][a-z0-9][a-z0-9._:-]{0,118}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(code,status=400){const e=new Error(code);e.code=code;e.status=status;throw e;}
function digest(value){return crypto.createHash('sha256').update(canonical(value)).digest('hex');}
function clean(value,field,max=160){if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail(field+'_invalid');return value.trim();}
function normalizeManifest(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('integration_manifest_required');
 const integrationId=clean(input.integrationId,'integration_id',120).toLowerCase();
 if(!ID.test(integrationId))fail('integration_id_invalid');
 const providerId=clean(input.providerId,'provider_id',120).toLowerCase();
 if(!ID.test(providerId))fail('provider_id_invalid');
 const displayName=clean(input.displayName,'display_name',160),version=clean(input.version,'integration_version',64);
 const principalId=clean(input.principalId,'principal_id',36);if(!UUID.test(principalId))fail('integration_principal_id_invalid');
 if(!Array.isArray(input.capabilities)||input.capabilities.length<1||input.capabilities.length>100)fail('capabilities_array_required');
 const seen=new Set();
 const capabilities=input.capabilities.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item))fail('capability_entry_invalid');
  const operation=clean(item.operation,'capability_operation',120).toLowerCase();
  if(!ID.test(operation)||seen.has(operation))fail('capability_operation_invalid_or_duplicate');seen.add(operation);
  const type=clean(item.type,'capability_type',30).toLowerCase(),riskTier=clean(item.riskTier,'risk_tier',20).toLowerCase();
  if(!CAPABILITY_TYPES.has(type))fail('capability_type_not_supported');if(!RISK_TIERS.has(riskTier))fail('risk_tier_not_supported');
  if(!Array.isArray(item.resourceTypes)||item.resourceTypes.length<1||item.resourceTypes.length>30)fail('capability_resource_types_required');
  const resourceTypes=[...new Set(item.resourceTypes.map(v=>clean(v,'resource_type',80).toLowerCase()))];
  if(resourceTypes.some(v=>v==='*'||!/^[a-z][a-z0-9._:-]{0,78}$/.test(v)))fail('wildcard_or_invalid_resource_type_forbidden');
  const sideEffects=item.sideEffects===true;
  const humanApprovalRequired=item.humanApprovalRequired===true||['approve','execute','delete'].includes(type)||['high','critical'].includes(riskTier);
  const evidenceRequired=item.evidenceRequired!==false;
  if(['modify','communicate','approve','execute','delete'].includes(type)&&!sideEffects)fail('side_effect_capability_must_declare_side_effects');
  return {operation,type,resourceTypes,riskTier,sideEffects,humanApprovalRequired,evidenceRequired};
 });
 const manifest={schemaVersion:'1.0.0',integrationId,providerId,displayName,version,principalId,capabilities};
 return {...manifest,manifestFingerprint:digest(manifest)};
}
function evaluateCapabilityRequest({registration,tenantId,actorPrincipalId,operation,resourceType}){
 const deny=reason=>({decision:'DENY',reasonCodes:[reason],execution:'NOT_EXECUTED'});
 if(!registration||registration.status!=='active')return deny('INTEGRATION_NOT_ACTIVE');
 if(registration.tenant_id!==tenantId)return deny('TENANT_SCOPE_MISMATCH');
 if(registration.principal_id!==actorPrincipalId)return deny('INTEGRATION_PRINCIPAL_MISMATCH');
 const manifest=registration.manifest;if(!manifest||!Array.isArray(manifest.capabilities))return deny('REGISTERED_MANIFEST_INVALID');
 const capability=manifest.capabilities.find(item=>item.operation===operation);
 if(!capability)return deny('OPERATION_NOT_DECLARED');
 if(!capability.resourceTypes.includes(resourceType))return deny('RESOURCE_TYPE_NOT_DECLARED');
 return {decision:capability.humanApprovalRequired?'REQUIRE_APPROVAL':'READY_FOR_AUTHORITY',
  reasonCodes:[capability.humanApprovalRequired?'HUMAN_APPROVAL_REQUIRED_BY_CAPABILITY_POLICY':'CAPABILITY_DECLARED'],
  capability:{operation:capability.operation,type:capability.type,riskTier:capability.riskTier,sideEffects:capability.sideEffects,humanApprovalRequired:capability.humanApprovalRequired,evidenceRequired:capability.evidenceRequired},
  execution:'NOT_EXECUTED'};
}
function sandboxEvaluate(scenarioId){
 const scenarios={
  'ACP-001':{operation:'customer.read_profile',resourceType:'customer_profile',expected:'READY_FOR_AUTHORITY'},
  'ACP-002':{operation:'payment.release',resourceType:'payment',expected:'REQUIRE_APPROVAL'},
  'ACP-003':{operation:'customer.export_all',resourceType:'customer_dataset',expected:'DENY'}
 };
 const scenario=scenarios[scenarioId];if(!scenario)fail('sandbox_scenario_not_found',404);
 const manifest=normalizeManifest({integrationId:'demo-crm-agent',providerId:'demo-crm',displayName:'Synthetic CRM Agent',version:'1.0.0',principalId:'11111111-1111-4111-8111-111111111111',capabilities:[
  {operation:'customer.read_profile',type:'read',resourceTypes:['customer_profile'],riskTier:'low',sideEffects:false},
  {operation:'payment.release',type:'execute',resourceTypes:['payment'],riskTier:'critical',sideEffects:true},
  {operation:'customer.export_all',type:'read',resourceTypes:['customer_profile'],riskTier:'high',sideEffects:false}
 ]});
 const registration={tenant_id:'22222222-2222-4222-8222-222222222222',principal_id:manifest.principalId,status:'active',manifest};
 const result=evaluateCapabilityRequest({registration,tenantId:registration.tenant_id,actorPrincipalId:manifest.principalId,operation:scenario.operation,resourceType:scenario.resourceType});
 return {scenarioId,expected:scenario.expected,result,passed:result.decision===scenario.expected,synthetic:true,execution:'DISABLED'};
}
module.exports={CAPABILITY_TYPES,RISK_TIERS,normalizeManifest,evaluateCapabilityRequest,sandboxEvaluate,digest};
