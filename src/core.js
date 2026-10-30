'use strict';

const crypto = require('node:crypto');

const classes = new Set([
  'observed',
  'derived',
  'estimated',
  'simulated',
  'ai_inferred'
]);

function stable(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map(key => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function fingerprint(value) {
  return crypto.createHash('sha256')
    .update(stable(value))
    .digest('hex');
}

function nn(value, name) {
  if (typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0) {
    throw Error(`${name} must be a finite non-negative number`);
  }
}

function validate(state) {
  if (!state || !Array.isArray(state.assets) || !state.assets.length) {
    throw Error('state.assets must contain at least one asset');
  }

  const ids = new Set();

  for (const asset of state.assets) {
    if (typeof asset.id !== 'string' ||
        !asset.id.trim() ||
        ids.has(asset.id)) {
      throw Error(`missing or duplicate asset id: ${asset.id || ''}`);
    }

    ids.add(asset.id);
    nn(asset.grossValue, 'grossValue');

    // Missing encumbrance is not silently converted into a verified zero.
    if (asset.encumberedValue !== undefined &&
        asset.encumberedValue !== null) {
      nn(asset.encumberedValue, 'encumberedValue');

      if (asset.encumberedValue > asset.grossValue) {
        throw Error('encumbrance exceeds gross value');
      }
    }

    if (!Array.isArray(asset.evidence) || !asset.evidence.length) {
      throw Error(`asset ${asset.id} requires evidence metadata`);
    }

    for (const evidence of asset.evidence) {
      if (!evidence.id ||
          !evidence.source ||
          !evidence.observedAt ||
          !classes.has(evidence.class)) {
        throw Error(
          `asset ${asset.id} evidence requires id, source, observedAt and supported class`
        );
      }
    }
  }

  return true;
}

function computeCapacity(state, policy, now = new Date()) {
  validate(state);

  if (!policy?.id || !policy?.version) {
    throw Error('versioned policy id and version are required');
  }

  if (typeof policy.haircutRate !== 'number' ||
      !Number.isFinite(policy.haircutRate) ||
      policy.haircutRate < 0 ||
      policy.haircutRate > 1) {
    throw Error('haircutRate must be a finite number between 0 and 1');
  }

  if (!Number.isFinite(policy.maxEvidenceAgeMs) ||
      policy.maxEvidenceAgeMs < 0) {
    throw Error('maxEvidenceAgeMs must be a finite non-negative number');
  }

  let gross = 0;
  let encumbered = 0;
  let net = 0;

  const issues = [];
  const assets = [];

  for (const asset of state.assets) {
    const hasEncumbrance =
      typeof asset.encumberedValue === 'number' &&
      Number.isFinite(asset.encumberedValue);

    const encumbranceValue = hasEncumbrance
      ? asset.encumberedValue
      : 0;

    const nextGross = gross + asset.grossValue;
    const nextEncumbered = encumbered + encumbranceValue;

    // Reject aggregate overflow rather than returning misleading totals.
    if (!Number.isFinite(nextGross)) {
      throw Error('aggregate gross value exceeds supported numeric range');
    }

    if (!Number.isFinite(nextEncumbered)) {
      throw Error('aggregate encumbered value exceeds supported numeric range');
    }

    gross = nextGross;
    encumbered = nextEncumbered;

    // This arithmetic value is diagnostic only when encumbrance is missing.
    // The issue below makes total capacity unavailable.
    const eligible = asset.grossValue - encumbranceValue;
    const nextNet = net + eligible;

    if (!Number.isFinite(nextNet)) {
      throw Error('aggregate eligible value exceeds supported numeric range');
    }

    net = nextNet;

    assets.push({
      assetId: asset.id,
      grossValue: asset.grossValue,
      encumberedValue: hasEncumbrance
        ? asset.encumberedValue
        : null,
      netEligibleBeforeHaircut: hasEncumbrance
        ? eligible
        : null
    });

    if (!hasEncumbrance) {
      issues.push({
        code: 'UNKNOWN_ENCUMBRANCE',
        assetId: asset.id,
        detail: 'Encumbered value is missing or null.'
      });
    }

    const seen = new Set();

    for (const evidence of asset.evidence) {
      if (seen.has(evidence.id)) {
        issues.push({
          code: 'DUPLICATE_EVIDENCE_ID',
          assetId: asset.id,
          evidenceId: evidence.id
        });
      }

      seen.add(evidence.id);

      const timestamp = Date.parse(evidence.observedAt);

      if (!Number.isFinite(timestamp)) {
        issues.push({
          code: 'INVALID_EVIDENCE_TIME',
          assetId: asset.id,
          evidenceId: evidence.id
        });
      } else if (timestamp > now.getTime() + 60000) {
        issues.push({
          code: 'FUTURE_EVIDENCE_TIME',
          assetId: asset.id,
          evidenceId: evidence.id
        });
      } else if (now.getTime() - timestamp > policy.maxEvidenceAgeMs) {
        issues.push({
          code: 'STALE_EVIDENCE',
          assetId: asset.id,
          evidenceId: evidence.id
        });
      }

      if (evidence.conflict) {
        issues.push({
          code: 'CONFLICTING_EVIDENCE',
          assetId: asset.id,
          evidenceId: evidence.id
        });
      }

      if (evidence.encumbranceStatus !== 'known') {
        issues.push({
          code: 'UNKNOWN_ENCUMBRANCE',
          assetId: asset.id,
          evidenceId: evidence.id,
          detail: 'Evidence does not explicitly establish known encumbrance status.'
        });
      }
    }

    if (asset.duplicateOf) {
      issues.push({
        code: 'POTENTIAL_DOUBLE_COUNT',
        assetId: asset.id,
        duplicateOf: asset.duplicateOf
      });
    }
  }

  return {
    currency: state.currency || 'USD',

    policy: {
      id: policy.id,
      version: policy.version,
      haircutRate: policy.haircutRate,
      maxEvidenceAgeMs: policy.maxEvidenceAgeMs
    },

    totals: {
      grossValue: gross,
      encumberedValue:
        assets.every(asset => asset.encumberedValue !== null) &&
        !issues.some(issue => issue.code === 'UNKNOWN_ENCUMBRANCE')
          ? encumbered
          : null,
      eligibleBeforeHaircut: issues.length ? null : net,
      capacity: issues.length
        ? null
        : Math.max(0, net * (1 - policy.haircutRate))
    },

    assets,
    issues,

    evidenceBoundary:
      'Only supplied records evaluated; no external registry or custodian queried.',

    inputFingerprint: fingerprint({ state, policy })
  };
}

function evaluateAction(payload, now = new Date()) {
  if (!payload || typeof payload !== 'object') {
    throw Error('request body required');
  }

  const { state, policy, action } = payload;

  if (!action?.id || !action?.type) {
    throw Error('action.id and action.type required');
  }

  nn(action.amount, 'action.amount');

  const capacity = computeCapacity(state, policy, now);

  let decision = 'ALLOW';
  const reasons = [];

  if (capacity.issues.length) {
    decision = 'HOLD';
    reasons.push(
      'Evidence or relationship issues require review before capacity can be relied upon.'
    );
  } else if (action.amount > capacity.totals.capacity) {
    decision = 'HOLD';
    reasons.push(
      'Requested amount exceeds policy-adjusted available capacity.'
    );
  }

  if (action.authorized !== true) {
    if (decision !== 'HOLD') {
      decision = 'REVIEW';
    }

    reasons.push('Action authorization was not explicitly confirmed.');
  }

  const core = {
    schemaVersion: 'keel-decision-0.2',
    decisionId: `kd_${crypto.randomUUID()}`,
    createdAt: now.toISOString(),

    action: {
      id: action.id,
      type: action.type,
      amount: action.amount,
      currency: state.currency || 'USD'
    },

    decision,
    reasons,
    capacity,
    policy: capacity.policy,

    evidenceClassBoundary:
      'Supplied evidence metadata is not independently authenticated by this local prototype.',

    nonExecutionNotice:
      'Advisory only; does not execute, block or settle transactions.'
  };

  return {
    ...core,
    recordFingerprint: fingerprint(core)
  };
}

module.exports = {
  fingerprint,
  computeCapacity,
  evaluateAction
};
