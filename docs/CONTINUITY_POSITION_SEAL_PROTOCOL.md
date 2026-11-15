# Keel PositionSeal Protocol v1

**Status:** implementation foundation; not yet a production or institution integration protocol.

## Purpose and boundary

A PositionSeal is an institution-signed statement of an account position at a stated instant. Keel validates the signature and registered issuer trust, preserves the exact evidence, and reports freshness separately. A seal is historical evidence, not a live balance, payment instruction, settlement confirmation, or guarantee that funds remain available.

A valid signature proves only that the holder of the registered issuer private key signed the payload. It does not prove the issuer's source data was correct or disclose later transactions, holds, reversals, corrections, key revocation, or legal claims.

## Envelope

`{ "payload": { ... }, "signature": "<base64url Ed25519 signature>" }`

The signature covers the UTF-8 bytes:

`PLUMBLINE-KEEL-POSITION-SEAL-V1\\n` + canonical JSON of the payload.

The domain prefix prevents accidental cross-protocol signature reuse. Algorithm is Ed25519. Issuer private keys remain with the institution, preferably in its HSM/KMS. Keel stores only registered public keys and key lifecycle metadata.

## Canonicalization profile

This first implementation uses a deliberately restricted canonical JSON profile, not a claim of RFC 8785/JCS conformance:
- JSON null, strings, booleans, arrays, and plain objects only.
- Object property names sorted using JavaScript's UTF-16 ordering.
- Strings escaped using JSON string serialization.
- Numeric values limited to finite safe integers; financial amounts are decimal integer strings.
- Undefined, non-plain objects, floating-point numbers, unsafe integers, and negative zero are rejected.

Before multi-language institutional integrations, publish independent cross-language test vectors and either adopt a vetted RFC 8785 implementation or formally freeze this restricted profile with equivalent test vectors.

## Payload fields

- `schemaVersion`: exactly `1.0.0`
- `evidenceId`, `tenantId`, `issuerId`, `accountRef`
- `currency`, `minorUnitExponent`
- `postedMinor`, `pendingDebitMinor`, `pendingCreditMinor`, `heldMinor`, `availableMinor`: exact integer strings
- `availabilityBasis`: issuer policy identifier, version, and bounded description
- `asOf`, `issuedAt`: UTC timestamps with millisecond precision
- `ledgerWatermark`: type, value, and issuer-defined inclusion semantics
- `previousCheckpointId`: previous checkpoint identifier or null
- `signingKeyId`: key identifier registered out-of-band

The issuer declares `availableMinor` and its calculation basis. Keel does not recompute it from posted, pending, and held values because issuer rules can differ. Negative posted and available positions are permitted; pending debit, pending credit, and held quantities are non-negative.

The account reference must be opaque and must not contain a raw account number or other direct identifier.

## Trust and freshness

Verification requires an independently provisioned issuer trust registration that binds tenant, issuer, key ID, Ed25519 public key, status, and validity period. A public key included only inside the submitted bundle is not a trust anchor.

The verifier returns separate dimensions: signature validity, issuer trust, payload validity, and freshness. An authentic aged/historical seal remains cryptographically verifiable but must never be represented as a current spendable balance. Offline verification cannot learn about later key revocation or supersession without refreshed trust metadata.

## Watermark and completeness

A timestamp is not a completeness proof. The issuer must define the watermark's type, ordering, and inclusion semantics. This module preserves those semantics but does not yet independently prove that a watermark covers a complete ledger interval. Until a source-specific recovery protocol verifies it, completeness must be reported as unverified.

## Not yet implemented

Persistent tenant-isolated evidence storage, issuer/key administration and key-event history, HTTP API integration, encrypted customer export, offline browser verifier, TransactionSeal, recovery reconciliation, backup/restore verification, and operational monitoring remain subsequent phases. No migration is executed and no production or staging environment is changed by this module.
