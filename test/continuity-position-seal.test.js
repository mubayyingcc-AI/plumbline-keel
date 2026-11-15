'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { canonicalize, signPositionSeal, verifyPositionSeal } = require('../src/continuity-position-seal');

const pair = crypto.generateKeyPairSync('ed25519');
const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
const now = new Date('2026-11-15T12:00:00.000Z');
const registration = {
  tenantId: 'tenant-a', issuerId: 'issuer-bank-a', keyId: 'key-2026-01',
  status: 'active', publicKeyPem
};
function payload(patch = {}) {
  return {
    schemaVersion: '1.0.0', evidenceId: 'seal-001', tenantId: 'tenant-a',
    issuerId: 'issuer-bank-a', accountRef: 'acct-opaque-001', currency: 'NGN',
    minorUnitExponent: 2, postedMinor: '250000000', pendingDebitMinor: '20000000',
    pendingCreditMinor: '10000000', heldMinor: '0', availableMinor: '240000000',
    availabilityBasis: { policyId: 'retail-current-account', version: '3', description: 'Issuer-declared available balance policy.' },
    asOf: '2026-11-15T11:59:00.000Z', issuedAt: '2026-11-15T11:59:10.000Z',
    ledgerWatermark: { type: 'core-ledger-sequence', value: '91822', semantics: 'All posted entries through this monotonically increasing sequence are included.' },
    previousCheckpointId: null, signingKeyId: 'key-2026-01', ...patch
  };
}
function envelope(patch = {}) {
  const p = payload(patch);
  return { payload: p, signature: signPositionSeal(p, privateKeyPem) };
}

test('canonical JSON is stable across object insertion order', () => {
  assert.equal(canonicalize({ b: 2, a: 1 }), canonicalize({ a: 1, b: 2 }));
});
test('registered issuer signature verifies and reports separate trust dimensions', () => {
  const result = verifyPositionSeal(envelope(), registration, { now });
  assert.equal(result.signatureValid, true);
  assert.equal(result.issuerTrusted, true);
  assert.equal(result.payloadValid, true);
  assert.equal(result.freshness, 'current');
  assert.equal(result.accountRef, 'acct-opaque-001');
});
test('altering any signed financial or checkpoint field invalidates signature', () => {
  for (const field of ['postedMinor', 'availableMinor', 'asOf', 'accountRef', 'ledgerWatermark']) {
    const e = envelope();
    if (field === 'ledgerWatermark') e.payload.ledgerWatermark.value = '91823';
    else e.payload[field] = field === 'postedMinor' ? '250000001' : field === 'availableMinor' ? '240000001' : field === 'asOf' ? '2026-11-15T11:58:00.000Z' : 'acct-other';
    assert.throws(() => verifyPositionSeal(e, registration, { now }), /position_seal_signature_invalid/);
  }
});
test('authentic historical evidence remains verifiable but is not labelled current', () => {
  const p = payload({ asOf: '2026-11-15T10:00:00.000Z', issuedAt: '2026-11-15T10:00:10.000Z' });
  const e = { payload: p, signature: signPositionSeal(p, privateKeyPem) };
  const result = verifyPositionSeal(e, registration, { now, currentWindowMs: 300000 });
  assert.equal(result.signatureValid, true);
  assert.equal(result.freshness, 'historical');
});
test('tenant and issuer trust-anchor substitution are rejected', () => {
  assert.throws(() => verifyPositionSeal(envelope(), { ...registration, tenantId: 'tenant-b' }, { now }), /tenant_scope_mismatch/);
  assert.throws(() => verifyPositionSeal(envelope(), { ...registration, issuerId: 'issuer-other' }, { now }), /issuer_identity_mismatch/);
  assert.throws(() => verifyPositionSeal(envelope(), { ...registration, publicKeyPem: crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }) }, { now }), /position_seal_signature_invalid/);
});
test('revoked issuer key is explicit even if its historical signature is intact', () => {
  assert.throws(() => verifyPositionSeal(envelope(), { ...registration, status: 'revoked' }, { now }), /issuer_key_revoked/);
});
test('negative posted and available balances are supported; pending and held amounts cannot be negative', () => {
  const p = payload({ postedMinor: '-100', availableMinor: '-150' });
  const e = { payload: p, signature: signPositionSeal(p, privateKeyPem) };
  assert.equal(verifyPositionSeal(e, registration, { now }).payloadValid, true);
  const bad = payload({ heldMinor: '-1' });
  assert.throws(() => signPositionSeal(bad, privateKeyPem), /invalid_heldMinor/);
});
test('financial values are exact integer strings and unknown extra floats are not signed', () => {
  const bad = payload({ postedMinor: '1.25' });
  assert.throws(() => signPositionSeal(bad, privateKeyPem), /invalid_postedMinor/);
  assert.throws(() => canonicalize({ amount: 1.25 }), /canonical_number_must_be_safe_integer/);
});
test('future-dated evidence is rejected', () => {
  const p = payload({ asOf: '2026-11-15T13:00:00.000Z', issuedAt: '2026-11-15T13:00:00.000Z' });
  const e = { payload: p, signature: signPositionSeal(p, privateKeyPem) };
  assert.throws(() => verifyPositionSeal(e, registration, { now }), /position_seal_from_future/);
});
