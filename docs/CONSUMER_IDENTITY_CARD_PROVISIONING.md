# Keel Consumer Identity & Trusted Human Card Provisioning
Status: implementation tranche on a feature branch. No identity provider, card manufacturer, delivery verifier or issuer is connected. Migration 010 is not applied to production.

## 1. Product boundary
Keel is building a physical-first human financial-control credential and its policy/evidence control plane. Keel is not an issuer, bank, card scheme, wallet custodian, identity-document repository or payment processor. A Keel consumer account is not a bank account and a card-order request is not an issued card.

The target sequence is:
1. Consumer authenticates with an approved identity provider.
2. Identity provider performs KYC/identity proofing and sends a signed result.
3. Keel stores only a provider-scoped pseudonymous subject reference, assurance level, evidence hash, verification time and expiry—not identity documents or biometrics.
4. Consumer creates a physical-card order request.
5. A contracted card programme partner accepts the order and performs personalisation.
6. Trusted carrier/delivery verifier proves delivery.
7. The card secure element completes Ed25519 proof-of-possession pairing and independent hardware attestation.
8. Consumer configures and tests independent recovery.
9. Keel evaluates financial eligibility, verified funding, mandates and spend controls.
10. A licensed issuer independently approves and provisions the virtual credential. Keel never creates a PAN, CVV or payment credential.

## 2. Identity provider contract
The first integration is a signed provider-event contract, not a home-grown KYC algorithm. Provider events include:
- `provider`, `eventId`, opaque `externalSubjectRef`, `externalReference`;
- `status`: verified, rejected, review_required or expired;
- `assurance`: substantial or high for verified status;
- SHA-256 evidence manifest hash;
- verification time, expiry and provider event timestamp.

The webhook uses HMAC-SHA256 over `<unix_timestamp>.<raw_request_body>`, headers `X-Keel-Timestamp` and `X-Keel-Signature: sha256=<hex>`, with a five-minute replay window. Provider ID is allowlisted by configuration. Event IDs are unique and idempotent. State changes are ordered by provider event time so an old event cannot overwrite a newer result.

Keel stores a keyed HMAC pseudonym of provider subject, not the subject itself. The dedicated `KEEL_CONSUMER_SUBJECT_HMAC_KEY` must be a stable, versioned secret distinct from the webhook signing secret. Rotation requires a controlled dual-key reindex migration; do not rotate it casually.

## 3. Consumer session
Consumer self-service APIs accept a short-lived RS256 JWT issued by the configured identity provider. Keel verifies signature using a pinned public key and configured key ID, issuer, audience, subject, token ID, issued-at and expiry. Maximum token lifetime is 15 minutes. Public-key rotation is a controlled deployment. No raw token is persisted. This is a first-provider integration profile; multi-key JWKS discovery, key rotation orchestration, session revocation and MFA policy integration remain required for production.

## 4. APIs
- `POST /api/consumer/identity/provider-events`: signed provider callback; no browser session.
- `GET /api/consumer/me`: authenticated consumer profile and card-order status.
- `POST /api/consumer/card-orders`: create an idempotent physical-card order request, requiring current verified identity, supported product, ISO-3166-1 alpha-2 delivery country, explicit terms acceptance and `Idempotency-Key`.

A successful order request is not a manufacturer order. It is stored as `submitted` and awaits a contracted partner adapter. The API explicitly returns `physicalCardOrdered=false` until a partner has accepted the order. No home address or payment method is collected in this tranche.

## 5. Card lifecycle and virtual eligibility
The deterministic lifecycle is:
`identity_pending → identity_verified → order_submitted → partner_accepted → personalised → dispatched → delivery_pending_verification → delivered_pending_pairing → paired → recovery_configured → recovery_tested → virtual_eligible → issuer_provisioning → virtual_active`.

Every privileged transition requires an evidence reference. The eligibility evaluator holds unless all are true:
- current verified identity and active consumer account;
- physical card delivery independently verified;
- hardware attestation and secure-element pairing verified;
- recovery group configured and recovery test passed;
- issuer programme configured;
- funding source independently verified;
- mandate and spend policy ready.

Eligibility means only "eligible for issuer review". It is not issuer approval and does not activate a payment credential.

## 6. Persistence and evidence
Migration 010 creates consumer account, external identity mapping, identity-provider event, card-order request, provisioning-event and append-only event-chain tables. It stores hashes and references, not document images, biometric templates, raw OIDC tokens, home addresses, PAN, CVV, PIN or private keys. The event chain is tamper-evident within the database; it is not independently notarised or WORM storage.

## 7. Configuration required before a provider sandbox can be connected
- `KEEL_IDENTITY_PROVIDER_ID`
- `KEEL_IDENTITY_WEBHOOK_SECRET` (32+ random bytes)
- `KEEL_CONSUMER_SUBJECT_HMAC_KEY` (32+ random bytes; stable/versioned)
- `KEEL_CONSUMER_SESSION_PUBLIC_KEY_PEM`
- `KEEL_CONSUMER_SESSION_ISSUER`
- `KEEL_CONSUMER_SESSION_AUDIENCE`
- `KEEL_CONSUMER_SESSION_KEY_ID`

Secrets must be provisioned through a managed secret store, never committed to Git or exposed in frontend code. No production values are currently configured.

## 8. Remaining production gates
- Select and contract an identity provider; verify its assurance scheme, jurisdiction coverage, sanctions/PEP and liveness processes as legally appropriate.
- Add OIDC/JWKS rotation, MFA and account/session revocation.
- Add consumer-specific hardware registry and pairing/recovery adapter; current physical pairing and recovery APIs are institution tenant/principal scoped and cannot be represented as a consumer app integration without this adapter.
- Select secure-element card manufacturer, applet, key ceremony, certificate authority and attestation verifier.
- Contract card personalisation, carrier, delivery proof and replacement processes.
- Build card partner order/status webhooks, delivery verification and dispute/fraud workflows.
- Integrate licensed issuer/program manager, tokenisation, network controls, virtual card lifecycle and issuer reconciliation.
- Implement double-entry ledger, verified balance/availability, atomic spend reservations and payment lifecycle before allowing spend.
- Add PostgreSQL RLS or equivalent isolation, concurrency tests, migration runner, penetration testing, incident response, data protection impact assessment, retention and deletion workflows.
- No live consumer onboarding, card ordering, manufacturing, delivery, virtual-card activation or payment execution until the relevant providers and controls are certified and tested.
