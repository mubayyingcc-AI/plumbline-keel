'use strict';

const crypto = require('node:crypto');
const { fingerprint } = require('./core');

const STATUSES = new Set(['SAFE_TO_RELEASE','CONDITIONAL_RELEASE','HOLD']);
const COMPONENT_KINDS = new Set(['model','prompt','retrieval','dataset','tool','agent','workflow','policy','runtime','integration']);
const CHECK_OUTCOMES = new Set(['passed','failed','not_run','waived']);
const RISK_TIERS = new Set(['low','moderate','high','critical']);

function required(value, field, max=200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw Object.assign(new Error('invalid_' + field), { code:'invalid_' + field });
  }
  return value.trim();
}
function digest(value, field) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw Object.assign(new Error('invalid_' + field), { code:'invalid_' + field });
  }
  return value.toLowerCase();
}
function safeTimestamp(value, field) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw Object.assign(new Error('invalid_' + field), { code:'invalid_' + field });
  return new Date(ms).toISOString();
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
function normaliseComponent(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('component_object_required');
  const kind = required(item.kind,'component_kind',40);
  if (!COMPONENT_KINDS.has(kind)) throw new Error('unsupported_component_kind');
  return {
    componentId:required(item.componentId,'component_id',160),
    kind,
    version:required(item.version,'component_version',160),
    fingerprint:digest(item.fingerprint,'component_fingerprint'),
    changeRef:item.changeRef == null ? null : required(item.changeRef,'component_change_ref',300)
  };
}
function normaliseCheck(check) {
  if (!check || typeof check !== 'object' || Array.isArray(check)) throw new Error('check_object_required');
  const outcome = required(check.outcome,'check_outcome',30);
  if (!CHECK_OUTCOMES.has(outcome)) throw new Error('unsupported_check_outcome');
  return {
    checkId:required(check.checkId,'check_id',160),
    category:required(check.category,'check_category',100),
    outcome,
    evidenceRef:check.evidenceRef == null ? null : required(check.evidenceRef,'check_evidence_ref',500),
    evidenceFingerprint:check.evidenceFingerprint == null ? null : digest(check.evidenceFingerprint,'check_evidence_fingerprint'),
    executedAt:check.executedAt == null ? null : safeTimestamp(check.executedAt,'check_executed_at'),
    rationale:check.rationale == null ? null : required(check.rationale,'check_rationale',1000)
  };
}
function assessRelease(input, now=new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('release_assessment_required');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('valid_assessment_clock_required');

  const release = {
    schemaVersion:'keel-ai-release-assessment/v1',
    releaseId:required(input.releaseId,'release_id',160),
    tenantRef:required(input.tenantRef,'tenant_ref',160),
    system:required(input.system,'system',200),
    environment:required(input.environment,'environment',80),
    riskTier:required(input.riskTier,'risk_tier',30),
    createdAt:safeTimestamp(input.createdAt,'created_at'),
    assessedAt:now.toISOString(),
    changeRef:required(input.changeRef,'change_ref',300),
    components:(input.components || []).map(normaliseComponent),
    requiredChecks:(input.requiredChecks || []).map(x=>required(x,'required_check',100)),
    checks:(input.checks || []).map(normaliseCheck),
    approval:input.approval && typeof input.approval === 'object' ? {
      status:required(input.approval.status,'approval_status',30),
      approverRef:input.approval.approverRef == null ? null : required(input.approval.approverRef,'approver_ref',160),
      approvedAt:input.approval.approvedAt == null ? null : safeTimestamp(input.approval.approvedAt,'approved_at'),
      scopeFingerprint:input.approval.scopeFingerprint == null ? null : digest(input.approval.scopeFingerprint,'approval_scope_fingerprint')
    } : null,
    rollback:input.rollback && typeof input.rollback === 'object' ? {
      planRef:required(input.rollback.planRef,'rollback_plan_ref',500),
      verified:input.rollback.verified === true,
      testedAt:input.rollback.testedAt == null ? null : safeTimestamp(input.rollback.testedAt,'rollback_tested_at')
    } : null
  };

  if (!RISK_TIERS.has(release.riskTier)) throw new Error('unsupported_risk_tier');
  if (!release.components.length) throw new Error('release_components_required');
  if (!release.requiredChecks.length) throw new Error('required_checks_required');
  if (new Set(release.requiredChecks).size !== release.requiredChecks.length) throw new Error('duplicate_required_check');
  if (new Set(release.components.map(x=>x.componentId)).size !== release.components.length) throw new Error('duplicate_component_id');
  if (new Set(release.checks.map(x=>x.checkId)).size !== release.checks.length) throw new Error('duplicate_check_id');

  const byCategory = new Map(release.checks.map(x=>[x.category,x]));
  const findings = [];
  for (const category of release.requiredChecks) {
    const check = byCategory.get(category);
    if (!check) findings.push({code:'REQUIRED_CHECK_MISSING',category});
    else if (check.outcome !== 'passed') findings.push({code:'REQUIRED_CHECK_NOT_PASSED',category,outcome:check.outcome});
    else if (!check.evidenceRef || !check.evidenceFingerprint || !check.executedAt) findings.push({code:'CHECK_EVIDENCE_INCOMPLETE',category});
  }
  for (const check of release.checks) {
    if (check.outcome === 'waived') findings.push({code:'CHECK_WAIVED',category:check.category,checkId:check.checkId});
  }

  const approvalRequired = ['high','critical'].includes(release.riskTier);
  if (approvalRequired) {
    if (!release.approval || release.approval.status !== 'approved' || !release.approval.approverRef || !release.approval.approvedAt || !release.approval.scopeFingerprint) {
      findings.push({code:'INDEPENDENT_APPROVAL_REQUIRED'});
    } else if (release.approval.scopeFingerprint !== fingerprint({
      releaseId:release.releaseId,changeRef:release.changeRef,components:release.components
    })) {
      findings.push({code:'APPROVAL_SCOPE_MISMATCH'});
    }
    if (!release.rollback || !release.rollback.verified || !release.rollback.testedAt) {
      findings.push({code:'VERIFIED_ROLLBACK_REQUIRED'});
    }
  }

  const status = findings.length ? 'HOLD' : 'SAFE_TO_RELEASE';
  const body = {
    schemaVersion:release.schemaVersion,
    release,
    decision:{status,findings,automaticDeploymentAuthorized:false},
    limitations:[
      'A passing assessment records supplied test and approval evidence; it does not independently execute tests or verify external systems.',
      'The assessment is not a regulatory certification, security audit, or authorization to deploy.',
      'The caller remains responsible for authenticating evidence producers and preserving source artifacts.'
    ]
  };
  return Object.freeze({...body,proofFingerprint:fingerprint(body)});
}

function verifyReleaseAssessment(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('release_assessment_record_required');
  const {proofFingerprint,...body}=record;
  if (!/^[a-f0-9]{64}$/.test(proofFingerprint || '')) return {valid:false,reason:'invalid_proof_fingerprint'};
  return {valid:fingerprint(body)===proofFingerprint,reason:fingerprint(body)===proofFingerprint?'valid':'proof_fingerprint_mismatch'};
}

module.exports={assessRelease,verifyReleaseAssessment,COMPONENT_KINDS,RISK_TIERS};
