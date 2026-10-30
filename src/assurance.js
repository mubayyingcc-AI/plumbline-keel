'use strict';
const crypto = require('node:crypto');
const { evaluateAction, fingerprint } = require('./core');

const EVIDENCE_CLASSES = new Set(['observed','verified','derived','estimated','ai_inferred','simulated']);
const FAILURE_CLASSES = new Set(['source_unavailable','provider_outage','stale_evidence','evidence_conflict','policy_drift','model_version_change','integrity_failure','unknown_outcome']);
const RECOVERY_ACTIONS = new Set(['wait','reassess','manual_review','suspend','stop']);

function requiredString(value, field, max=200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(field + ' is required and must be at most ' + max + ' characters');
  return value.trim();
}
function optionalString(value, max=500) {
  return typeof value === 'string' ? value.trim().slice(0,max) : null;
}
function buildOriginMark(source, now=new Date()) {
  if (!source || typeof source !== 'object') throw new Error('OriginMark source object required');
  const mark = {
    sourceId: requiredString(source.sourceId,'source.sourceId'),
    sourceType: requiredString(source.sourceType,'source.sourceType'),
    sourceName: requiredString(source.sourceName,'source.sourceName'),
    observedAt: requiredString(source.observedAt,'source.observedAt',80),
    ingestedAt: now.toISOString(),
    ingestionMethod: requiredString(source.ingestionMethod,'source.ingestionMethod'),
    evidenceClass: requiredString(source.evidenceClass,'source.evidenceClass',40),
    externalReference: optionalString(source.externalReference,500),
    contentFingerprint: source.contentFingerprint || fingerprint(source.content || {
      sourceId:source.sourceId, observedAt:source.observedAt, externalReference:source.externalReference || null
    })
  };
  if (!EVIDENCE_CLASSES.has(mark.evidenceClass)) throw new Error('unsupported evidenceClass');
  if (!/^[a-f0-9]{64}$/i.test(mark.contentFingerprint)) throw new Error('contentFingerprint must be a SHA-256 hex digest');
  if (!Number.isFinite(Date.parse(mark.observedAt))) throw new Error('source.observedAt must be a valid timestamp');
  return mark;
}
function buildModelCensus(model) {
  if (!model || typeof model !== 'object') throw new Error('ModelCensus model object required');
  return {
    modelId: requiredString(model.modelId,'model.modelId'),
    provider: requiredString(model.provider,'model.provider'),
    modelName: requiredString(model.modelName,'model.modelName'),
    version: requiredString(model.version,'model.version'),
    owner: requiredString(model.owner,'model.owner'),
    purpose: requiredString(model.purpose,'model.purpose',500),
    accessScope: requiredString(model.accessScope,'model.accessScope',500),
    external: model.external === true,
    registeredAt: new Date().toISOString(),
    modelFingerprint: fingerprint({
      modelId:model.modelId,provider:model.provider,modelName:model.modelName,
      version:model.version,owner:model.owner,purpose:model.purpose,accessScope:model.accessScope
    })
  };
}
function buildRuleTrace(policy, assessment) {
  if (!policy || typeof policy !== 'object') throw new Error('RuleTrace policy required');
  return {
    policyId: requiredString(policy.id,'policy.id'),
    policyVersion: requiredString(policy.version,'policy.version'),
    haircutRate: policy.haircutRate,
    maxEvidenceAgeMs: policy.maxEvidenceAgeMs,
    exceptions: Array.isArray(policy.exceptions) ? policy.exceptions : [],
    thresholds: policy.thresholds && typeof policy.thresholds === 'object' ? policy.thresholds : {},
    inputsFingerprint: fingerprint({state:assessment.state, action:assessment.action}),
    policyFingerprint: fingerprint(policy)
  };
}
function buildDecisionWitness(witness, decision) {
  if (!witness || typeof witness !== 'object') throw new Error('DecisionWitness is required');
  const status = requiredString(witness.status,'witness.status',30);
  if (!['accepted','overridden','rejected','pending'].includes(status)) throw new Error('unsupported DecisionWitness status');
  if (status !== 'pending') requiredString(witness.reviewerId,'witness.reviewerId');
  if (status === 'overridden' || status === 'rejected') requiredString(witness.rationale,'witness.rationale',2000);
  return {
    witnessId: crypto.randomUUID(),
    reviewerId: optionalString(witness.reviewerId,160),
    role: optionalString(witness.role,120),
    status,
    rationale: optionalString(witness.rationale,2000),
    reviewedAt: status === 'pending' ? null : new Date().toISOString(),
    decisionFingerprint: decision.recordFingerprint
  };
}
function buildFallbackMandate(failures=[]) {
  if (!Array.isArray(failures)) throw new Error('failures must be an array');
  const normalized = failures.map(f => {
    const code = requiredString(f.code,'failure.code',60);
    if (!FAILURE_CLASSES.has(code)) throw new Error('unsupported failure class: ' + code);
    return {code, detail:optionalString(f.detail,1000), affectedReference:optionalString(f.affectedReference,300)};
  });
  const action = normalized.length ? 'manual_review' : 'reassess';
  return {
    status: normalized.length ? 'restricted' : 'clear',
    permittedAction: RECOVERY_ACTIONS.has(action) ? action : 'stop',
    failures: normalized,
    automaticFinancialExecution: false,
    rule: normalized.length
      ? 'Affected decision is held; preserve evidence and require an accountable reviewer before proceeding.'
      : 'No declared failure condition; this assessment remains advisory and does not authorize execution.'
  };
}
function buildProofDocket(payload, now=new Date()) {
  if (!payload || typeof payload !== 'object') throw new Error('assessment payload required');
  const decision = evaluateAction({state:payload.state,policy:payload.policy,action:payload.action},now);
  const originMarks = (payload.sources || []).map(source => buildOriginMark(source,now));
  const modelCensus = (payload.models || []).map(buildModelCensus);
  const ruleTrace = buildRuleTrace(payload.policy,{state:payload.state,action:payload.action});
  const decisionWitness = buildDecisionWitness(payload.witness,decision);
  const fallbackMandate = buildFallbackMandate(payload.failures || []);
  const classificationBoundary = {
    verifiedMeans: 'Verification status is asserted only by the supplied evidence source; Keel does not independently query registries or custodians.',
    aiInferenceBoundary: 'AI-inferred material is not upgraded to observed or verified evidence.',
    executionBoundary: 'Keel is advisory; this record does not authorize or execute a financial transaction.'
  };
  const record = {
    schemaVersion:'keel-proof-docket-1.0',
    docketId:'kdock_' + crypto.randomUUID(),
    createdAt:now.toISOString(),
    decision,
    originMarks,
    modelCensus,
    ruleTrace,
    decisionWitness,
    fallbackMandate,
    classificationBoundary
  };
  record.docketFingerprint = fingerprint(record);
  return record;
}
function assessDrift(previous, current) {
  if (!previous || !current) throw new Error('previous and current state are required');
  const changes = [];
  for (const key of ['evidenceFingerprint','policyFingerprint','modelFingerprint','providerFingerprint','integrationFingerprint']) {
    if ((previous[key] || null) !== (current[key] || null)) {
      changes.push({dimension:key,from:previous[key] || null,to:current[key] || null,requiresReassessment:true});
    }
  }
  return {
    driftId:'drift_' + crypto.randomUUID(),
    detectedAt:new Date().toISOString(),
    status:changes.length ? 'reassessment_required' : 'no_material_change_detected',
    changes,
    fingerprint:fingerprint(changes)
  };
}
module.exports = {
  buildOriginMark, buildModelCensus, buildRuleTrace, buildDecisionWitness,
  buildFallbackMandate, buildProofDocket, assessDrift, EVIDENCE_CLASSES, FAILURE_CLASSES
};
