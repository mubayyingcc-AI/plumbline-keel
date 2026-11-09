# Consumer Human Card Security & Recovery
Status: engineering implementation tranche. No live manufacturer, attestation lab, carrier, issuer or consumer production identity integration is connected. Migration 011 is not applied to production.

## Security model
The Human Card is a physical-first secure-element credential. Keel stores the public key and its fingerprint, never the private key, PIN, PAN, CVV or payment token. A licensed issuer remains responsible for payment credentials, authorisation and network blocking. Keel's local emergency lock is not a substitute for issuer-side blocking.

## Partner and evidence trust boundaries
Three separately configured integrations are required:
- Card programme partner: signed personalisation event containing opaque order/card references and an Ed25519 public key.
- Independent hardware attestation verifier: signed result with evidence hash, hardware model, public-key fingerprint and expiry.
- Independent delivery verifier: signed delivered status and evidence hash.

Each webhook uses HMAC-SHA256 over `<unix_timestamp>.<raw_body>`, with a five-minute freshness window. Separate secrets and partner/verifier IDs are required. Event IDs are unique per partner/verifier. Keel hashes opaque card references and evidence references; it does not retain delivery address or identity-document evidence. A signed callback proves the configured sender supplied the event; it does not itself prove the underlying hardware is secure. Verifier accreditation, certificate chain, secure-element production controls and audit scope require external due diligence.

## Physical pairing
1. Personalisation creates a consumer card record with Ed25519 public key.
2. Independent verifier confirms attestation and the key fingerprint.
3. Independent carrier confirms delivery.
4. Consumer requests a one-time challenge.
5. Secure element signs a challenge bound to consumer ID, card ID, random nonce, monotonic counter and expiry.
6. Keel verifies signature, nonce, expiry, card state and counter in a database transaction.
7. Card becomes paired. A paired card is not yet eligible for virtual activation or payment execution.

## Emergency lock
The consumer can lock their own card using an authenticated session. Keel atomically changes local state and writes an outbox event. This does not guarantee issuer/network authorisation blocks until the issuer adapter acknowledges the event. It cannot reverse an already authorised, captured, cleared or settled transaction. An operational outbox dispatcher and issuer acknowledgement/reconciliation are still required.

## Recovery
- Recovery group: 2–7 distinct, currently identity-verified consumer trustees, threshold at least 2, delay 24–168 hours.
- Group is bound to a paired card.
- Recovery test is non-destructive: trustee threshold approval plus configured delay, then a recorded test result; the card remains paired.
- Actual lost/stolen/compromised recovery moves the card to recovery pending and writes an emergency-lock outbox event. Threshold rejection blocks the request. Threshold approval and delay revoke the old card in Keel and require a replacement physical card; no automatic credential restoration.
- Trustees must not be the owner and each can respond once. Production needs trustee invitation/consent, account recovery safeguards, revocation, notification, quorum changes, dispute and coercion handling.

## API surface
Consumer (short-lived signed session):
- `GET /api/consumer/cards`
- `POST /api/consumer/cards/pairing/challenge`
- `POST /api/consumer/cards/pairing/verify`
- `POST /api/consumer/cards/lock`
- `POST /api/consumer/recovery/groups` (requires `cardId`, `trusteeConsumerIds`, `threshold`, `delayHours`)
- `POST /api/consumer/recovery/requests` (reason: lost, stolen, compromised, recovery_test or replacement)
- `POST /api/consumer/recovery/requests/{requestId}/approval`
- `POST /api/consumer/recovery/requests/{requestId}/finalise`

Partner callbacks:
- `POST /api/partners/card-programme/events`
- `POST /api/partners/card-attestation/events`
- `POST /api/partners/card-delivery/events`

## Required configuration
- `KEEL_CARD_PARTNER_ID`, `KEEL_CARD_PARTNER_WEBHOOK_SECRET`
- `KEEL_CARD_ATTESTATION_VERIFIER_ID`, `KEEL_CARD_ATTESTATION_WEBHOOK_SECRET`
- `KEEL_CARD_DELIVERY_VERIFIER_ID`, `KEEL_CARD_DELIVERY_WEBHOOK_SECRET`
- Consumer identity/session configuration documented in `docs/CONSUMER_IDENTITY_CARD_PROVISIONING.md`.

Use independent random 32+ byte secrets in a managed secret store. Do not reuse the identity webhook secret or consumer subject HMAC key.

## Production gates still open
- Accredited hardware attestation authority and secure-element certificate chain / key ceremony.
- Secure-element card hardware, firmware, applet, tamper and side-channel assessment.
- Real partner sandbox, signed event contract tests, partner event replay protection, operational webhook delivery and retry.
- Carrier identity/delivery proof due diligence and address privacy controls.
- Consumer app/device binding, MFA, session revocation, device loss, SIM-swap and phishing defence.
- Trustee invitation/consent, notifications, trustee replacement, recovery disputes and social-engineering threat model.
- Outbox dispatcher with issuer acknowledgements; issuer/network instant block and card replacement integration.
- Migration runner, PostgreSQL E2E/concurrency tests, RLS or equivalent access review, backup/restore, monitoring, penetration test, privacy impact assessment, retention/deletion.
- Double-entry financial ledger, verified available funds, atomic spend reservations, issuer tokenisation and full payment lifecycle.
- Independent legal, regulatory, scheme and security review in each launch jurisdiction.

No migration has been applied, no production secrets configured, no partner integrated, no card manufactured or delivered, and no financial credential issued.