'use strict';

const crypto = require('node:crypto');

const DOMAIN = 'PLUMBLINE-KEEL-POSITION-SEAL-V1\\n';
const DEFAULT_CURRENT_WINDOW_MS = 5 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;
const AMOUNT = /^(?:0|[1-9][0-9]*)$/;
const SIGNED_AMOUNT = /^(?:0|-?[1-9][0-9]*)$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,119}$/;
const CURRENCY = /^[A-Z][A-Z0-9]{2,11}$/;

function fail(code) { throw Object.assign(new Error(code), { code }); }
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Keel PositionSeal v1 uses a deliberately restricted canonical JSON profile:
// JSON values only, plain objects, finite safe-integer numbers, sorted UTF-16
// property names, and JSON string escaping. Financial quantities are strings.
function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail('canonical_number_must_be_safe_integer');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (!isPlainObject(value)) fail('canonical_value_must_be_json');
  const keys = Object.keys(value).sort();
  return '{' + keys.map((key) => {
    if (value[key] === undefined) fail('canonical_undefined_not_allowed');
    return JSON.stringify(key) + ':' + canonicalize(value[key]);
  }).join(',') + '}';
}

function isoTime(value, field) {
  if (typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(value)) fail('invalid_' + field);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) fail('invalid_' + field);
  return ms;
}

function validatePayload(p) {
  if (!isPlainObject(p)) fail('position_seal_payload_required');
  if (p.schemaVersion !== '1.0.0') fail('unsupported_position_seal_schema');
  for (const field of ['evidenceId', 'tenantId', 'issuerId', 'accountRef', 'currency', 'signingKeyId']) {
    if (typeof p[field] !== 'string' || !ID.test(p[field])) fail('invalid_' + field);
  }
  if (!CURRENCY.test(p.currency)) fail('invalid_currency');
  if (!Number.isSafeInteger(p.minorUnitExponent) || p.minorUnitExponent < 0 || p.minorUnitExponent > 9) fail('invalid_minor_unit_exponent');
  for (const field of ['postedMinor', 'availableMinor']) {
    if (typeof p[field] !== 'string' || !SIGNED_AMOUNT.test(p[field])) fail('invalid_' + field);
  }
  for (const field of ['pendingDebitMinor', 'pendingCreditMinor', 'heldMinor']) {
    if (typeof p[field] !== 'string' || !AMOUNT.test(p[field])) fail('invalid_' + field);
  }
  if (!isPlainObject(p.availabilityBasis) || typeof p.availabilityBasis.policyId !== 'string' || !ID.test(p.availabilityBasis.policyId) ||
      typeof p.availabilityBasis.version !== 'string' || !ID.test(p.availabilityBasis.version) ||
      typeof p.availabilityBasis.description !== 'string' || p.availabilityBasis.description.length < 1 || p.availabilityBasis.description.length > 500) {
    fail('invalid_availability_basis');
  }
  if (!isPlainObject(p.ledgerWatermark) || typeof p.ledgerWatermark.type !== 'string' || !ID.test(p.ledgerWatermark.type) ||
      typeof p.ledgerWatermark.value !== 'string' || !p.ledgerWatermark.value.trim() ||
      typeof p.ledgerWatermark.semantics !== 'string' || !p.ledgerWatermark.semantics.trim() || p.ledgerWatermark.semantics.length > 500) {
    fail('invalid_ledger_watermark');
  }
  if (p.previousCheckpointId !== null && (typeof p.previousCheckpointId !== 'string' || !ID.test(p.previousCheckpointId))) fail('invalid_previous_checkpoint_id');
  const asOf = isoTime(p.asOf, 'as_of');
  const issuedAt = isoTime(p.issuedAt, 'issued_at');
  if (issuedAt < asOf) fail('issued_before_observation');
  return { asOf, issuedAt };
}

function signingBytes(payload) {
  validatePayload(payload);
  return Buffer.from(DOMAIN + canonicalize(payload), 'utf8');
}

function verifyKeyRegistration(registration, payload, now) {
  if (!isPlainObject(registration)) fail('issuer_trust_anchor_required');
  if (registration.tenantId !== payload.tenantId) fail('tenant_scope_mismatch');
  if (registration.issuerId !== payload.issuerId) fail('issuer_identity_mismatch');
  if (registration.keyId !== payload.signingKeyId) fail('issuer_key_id_mismatch');
  if (registration.status !== 'active') fail(registration.status === 'revoked' ? 'issuer_key_revoked' : 'issuer_key_not_active');
  if (typeof registration.publicKeyPem !== 'string') fail('invalid_issuer_public_key');
  let key;
  try { key = crypto.createPublicKey(registration.publicKeyPem); } catch { fail('invalid_issuer_public_key'); }
  if (key.asymmetricKeyType !== 'ed25519') fail('issuer_key_must_be_ed25519');
  for (const field of ['validFrom', 'validUntil']) {
    if (registration[field] !== undefined && (!Number.isFinite(Date.parse(registration[field])) || typeof registration[field] !== 'string')) fail('invalid_issuer_key_' + field);
  }
  if (registration.validFrom && now < Date.parse(registration.validFrom)) fail('issuer_key_not_yet_valid');
  if (registration.validUntil && now > Date.parse(registration.validUntil)) fail('issuer_key_expired');
  return key;
}

function verifyPositionSeal(envelope, registration, options = {}) {
  if (!isPlainObject(envelope) || !isPlainObject(envelope.payload)) fail('position_seal_envelope_required');
  const payload = envelope.payload;
  const { asOf, issuedAt } = validatePayload(payload);
  const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (!Number.isFinite(nowDate.getTime())) fail('invalid_verification_time');
  const key = verifyKeyRegistration(registration, payload, nowDate.getTime());
  if (typeof envelope.signature !== 'string' || !/^[A-Za-z0-9_-]{80,120}$/.test(envelope.signature)) fail('invalid_position_seal_signature');
  let signatureValid = false;
  try { signatureValid = crypto.verify(null, signingBytes(payload), key, Buffer.from(envelope.signature, 'base64url')); } catch { /* normalized below */ }
  if (!signatureValid) fail('position_seal_signature_invalid');

  const now = nowDate.getTime();
  if (asOf > now + MAX_FUTURE_SKEW_MS || issuedAt > now + MAX_FUTURE_SKEW_MS) fail('position_seal_from_future');
  const ageMs = Math.max(0, now - asOf);
  const currentWindowMs = Number.isSafeInteger(options.currentWindowMs) && options.currentWindowMs >= 0
    ? options.currentWindowMs : DEFAULT_CURRENT_WINDOW_MS;
  const freshness = ageMs <= currentWindowMs ? 'current' : 'historical';

  return Object.freeze({
    signatureValid: true,
    issuerTrusted: true,
    payloadValid: true,
    freshness,
    ageMs,
    evidenceId: payload.evidenceId,
    issuerId: payload.issuerId,
    tenantId: payload.tenantId,
    accountRef: payload.accountRef,
    currency: payload.currency,
    asOf: new Date(asOf).toISOString(),
    issuedAt: new Date(issuedAt).toISOString(),
    watermark: Object.freeze({ ...payload.ledgerWatermark }),
    boundary: 'This proves that the registered issuer key signed this payload and that the payload passed schema validation. It does not independently prove that the issuer source data was correct, that funds remain available now, or that later transactions, holds, revocations or corrections do not exist.'
  });
}

function signPositionSeal(payload, privateKeyPem) {
  let key;
  try { key = crypto.createPrivateKey(privateKeyPem); } catch { fail('invalid_issuer_private_key'); }
  if (key.asymmetricKeyType !== 'ed25519') fail('issuer_key_must_be_ed25519');
  return crypto.sign(null, signingBytes(payload), key).toString('base64url');
}

module.exports = {
  DOMAIN,
  DEFAULT_CURRENT_WINDOW_MS,
  canonicalize,
  validatePayload,
  signingBytes,
  signPositionSeal,
  verifyPositionSeal
};
