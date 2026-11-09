# Keel Human Card — Pairing Protocol v1
Status: implementation foundation; no physical hardware or issuer is certified.

## Objective
Prove possession of a delivered physical Keel Human Card by a cryptographic challenge-response. Pairing is tenant- and named-principal-bound, one-time, expiring, replay-resistant and audited. This protocol establishes device possession only. It does not itself establish legal identity, cardholder identity verification, hardware provenance, payment authorisation or virtual-card issuance.

## Prerequisites
A trusted card-personalisation/issuer integration must provision a device record in `keel_human_card_devices` with:
- principal and tenant binding;
- card pseudonymous identifier;
- Ed25519 public key generated inside the card secure element;
- public-key fingerprint and certificate reference;
- verified delivery timestamp from a trusted delivery verifier;
- independently verified hardware attestation reference, verifier identity and timestamp;
- `device_status='delivered_pending_pairing'` and `lifecycle_state='physical_card_delivered_pending_pairing'`.

There is intentionally no public self-service endpoint that accepts a browser's `delivered=true` or `attested=true` assertions. Device provisioning and delivery/attestation verification adapters are separate integration work.

## Challenge request
Authenticated API key must be associated with the exact `principal_id` owning the device. `POST /api/human-card/pairing/challenge` accepts only `cardId`. The server locks the tenant-scoped device row and checks delivery, public-key presence and independent hardware-attestation evidence. It generates:
- 256-bit cryptographically random nonce;
- random challenge UUID;
- expected monotonic device counter (last accepted counter + 1);
- 120-second expiry;
- canonical UTF-8 message.

Canonical message, newline separated:
1. `KEEL-HUMAN-CARD-PAIRING-V1`
2. tenant UUID
3. principal UUID
4. card ID
5. challenge UUID
6. nonce (base64url)
7. expected counter (decimal)
8. expiry (ISO-8601 UTC)

Only SHA-256(nonce), challenge metadata and expiry are persisted. The nonce and canonical message are returned once to the authenticated principal.

## Card proof
The secure element signs the exact canonical message using Ed25519. Private key must be generated on-card and non-exportable. No browser or mobile application may substitute its own key for the card key. Hardware attestation and certificate chain validation must be performed by a trusted provisioner/verifier before the challenge API is enabled for production.

## Verification
`POST /api/human-card/pairing/verify` accepts challenge ID, nonce and base64url signature. The server:
1. Locks the challenge and device rows within the authenticated tenant/principal.
2. Rejects missing, cross-tenant, cross-principal, consumed or expired challenges.
3. Marks the challenge consumed within the same transaction before evaluating proof, so failed submitted proofs cannot be retried against that challenge.
4. Checks the nonce hash, current device lifecycle, hardware-attestation flag and expected counter.
5. Verifies the Ed25519 signature against the registered public key and canonical message.
6. On success, atomically marks the device paired, updates its counter and appends a Keel Authority Chain event.
7. On failure, appends a failure event and commits challenge consumption.

The response after pairing explicitly leaves the virtual channel locked. Recovery configuration and a successful recovery test are separate mandatory steps. Issuer provisioning and financial mandate/funding checks remain later gates.

## Threat model and safeguards
- Replay: one-time challenge consumption and monotonic counter.
- Cross-tenant/principal substitution: composite tenant/card/principal constraints and authenticated principal binding.
- Challenge interception: signature requires non-exportable device private key.
- Online guessing: failed submitted proof consumes challenge; production still needs distributed throttling and abuse monitoring.
- Device cloning: secure-element key and independently verified hardware attestation are required; this code alone cannot detect a cloned/compromised chip.
- Delivery fraud: delivery proof must be sourced from a trusted delivery verifier, not the user.
- Database compromise: SHA-256 nonce hash avoids storing the raw nonce; the database remains trusted for challenge state. Independent audit anchoring and key management remain future requirements.
- Recovery compromise: recovery must not silently reactivate a revoked card or create spending authority.

## Security boundaries
Keel stores public keys and references only. It must never store private keys, seed phrases, PIN, CVV, PAN, biometric templates or card secrets. This pairing protocol does not make Keel a custodian, issuer, wallet or card scheme.

## Current implementation limitations
- Ed25519 challenge construction and signature verification are implemented in Node's crypto library.
- Tenant/principal-bound challenge and verify API routes are implemented.
- PostgreSQL challenge table and device-attestation evidence fields are in migration 008.
- Hardware personalisation, card secure-element applet, secure boot, certificate authority, attestation verifier, trusted delivery integration and partner provisioning adapter are not implemented.
- Migrations 007 and 008 are not applied to Railway; no production deployment is made.
- No live physical or virtual payment credential can be activated by these routes.

Before accepting a signature, Keel recomputes SHA-256 over the registered Ed25519 SubjectPublicKeyInfo DER and compares it with the stored device key fingerprint. A mismatch fails closed. This is a key-identity consistency check, not proof that hardware is genuine; hardware attestation remains a separate trusted-provisioning requirement.
