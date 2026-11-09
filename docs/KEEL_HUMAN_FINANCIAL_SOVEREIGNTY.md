# Keel Human Financial Sovereignty System
## Physical-first Human Card and resilient digital-finance architecture
Version 1.0 — 9 November 2026

## 1. Mission
Keel is a human-controlled financial access, authority, evidence and continuity layer for a world of AI agents, tokenised money, stablecoins, digital deposits, programmable payments and increasingly interconnected financial infrastructure.

The mission is not to promise that no person can ever lose money. No card, blockchain, bank, reserve, insurer or software can guarantee that. Keel's measurable mission is to reduce avoidable loss and single-provider dependency; make financial exposure visible; preserve human control; improve recoverability; and maintain evidence when institutions, networks, currencies or providers fail.

Product promise: "Your money. Your authority. More than one route. Evidence when it matters."

## 2. Product definition
**Keel Human Card** is a physical-first, human-owned security and financial-access credential. The physical card is the root possession factor and authority anchor for the user's Keel identity. The virtual payment channel is a later, controlled extension. It is not independently activated before the physical card is received, delivery is verified, the card is cryptographically paired, and account recovery has been configured and tested.

Keel is not simply a plastic debit card, a crypto card, an AI wallet or a bank account. It is a decentralised-by-design control architecture with partner-connected payment channels.

Important distinction: Keel may decentralise identity keys, user authorisation and control over access, but ordinary card-network acceptance and settlement remain dependent on issuers, acquirers, schemes, banks and telecom/internet infrastructure. Keel must never describe a Visa/Mastercard-style programme as fully decentralised.

## 3. Physical-first issuance lifecycle
1. Account verified: user establishes a Keel identity and legal onboarding through appropriate regulated partners.
2. Physical card ordered: a unique device/card record is reserved; no payment credential is yet active.
3. Physical card dispatched: issuer/manufacturer logistics status is recorded.
4. Physical card delivered: delivery proof is verified independently; self-declared delivery is insufficient.
5. Physical card paired: card secure element signs a fresh, one-time server challenge. The server validates certificate chain, device identity, revocation status, counter/anti-replay and cryptographic signature.
6. Recovery configured: user establishes a recovery method independent of the primary card and tests recovery. No single recovery operator should silently gain unilateral spending authority.
7. Virtual channel eligible: Keel verifies active mandate, user authority, security posture and trusted funding-source configuration.
8. Virtual payment credential provisioned: only an authorised issuer/programme manager provisions an actual virtual card credential. Keel receives opaque references and safe display metadata only.

No skipping stages. A lost card before pairing remains unactivated. A replacement card requires explicit revocation of the lost device and fresh pairing. Recovery must not silently reactivate a revoked device. Virtual channel is locked if physical device is reported lost, pairing assurance expires, recovery is compromised or mandate is revoked, subject to preserving the state of transactions already in flight.

## 4. Physical card hardware model
The physical card should be a secure-element smart card, with NFC and optional contact interface; evaluate certified hardware, secure boot/personalisation, tamper resistance, anti-cloning and key lifecycle. Generate the device private key inside the secure element and make it non-exportable. Keel stores the public key, certificate chain reference, hardware model/attestation evidence, key fingerprint, device status and counter—not the private key, PIN, seed phrase or biometric template.

Use challenge-response with server-generated nonce, expiry, one-time consumption and monotonic counter where supported. Pairing proof is bound to tenant, principal, card serial pseudonym, device key, session, purpose and timestamp. A photo of the card, printed QR code or serial number alone is not possession proof. Do not place seed phrases, private keys, PAN, CVV or PIN on a printed QR or in Keel logs.

The card is not automatically a hardware wallet or offline money. NFC secure-element identity authentication and EMV payment applets are separate functions and require separate certification/programme work.

## 5. What decentralisation means in Keel
Decentralise where it genuinely improves user control:
- User-held, hardware-protected signing key for identity and high-risk authorisation.
- Open, documented identity and event formats; user-authorised portability.
- Multiple independent recovery trustees/devices with threshold recovery, time delays and alerts, rather than a single Keel-admin reset.
- Provider-neutral account, wallet, payment and asset connectors.
- User-visible mandates and signed consent/revocation events.
- Cryptographically verifiable receipts and exportable financial history.
- Multiple funding and payment rails where legally available.

Do not decentralise away accountability:
- Regulated issuers, custodians, banks, MTOs and virtual-asset providers remain responsible for activities they legally perform.
- Key recovery, AML/CFT, sanctions, consumer redress, privacy and incident response require accountable governance.
- Do not use a DAO vote as a substitute for legal authority or customer support.

## 6. Human financial protection layer
Keel should build a Financial Resilience Map for each user. It is a private, consented inventory—not a custody account or investment recommendation. It distinguishes:
- bank deposits and the actual legal bank/depositor relationship;
- safeguarded e-money balances and the safeguarding entity;
- cash held by the user;
- tokenised deposits and their issuing bank;
- stablecoins, issuer, reserve disclosures, redemption terms and network;
- self-custodied digital assets and the user's key/recovery arrangement;
- pensions, securities, receivables and other assets;
- liabilities, guarantees, payment commitments and restricted funds.

For each position show legal holder/beneficial owner evidence where available, provider/custodian, jurisdiction, insolvency treatment (verified/unknown), liquidity, redemption conditions, concentration, counterparty exposure, price/FX risk, operational dependency, last verification time and confidence. Do not imply that a blockchain balance proves legal title, reserve backing or redemption.

Keel Resilience Controls:
A. Exposure map: provider, jurisdiction, currency, issuer, custodian, chain and concentration.
B. Availability map: settled vs pending vs restricted vs reserved vs disputed; source freshness and reconciliation.
C. Redemption map: who owes the user, how to redeem, legal terms, cut-off windows and failure route.
D. Continuity map: alternative lawful providers/rails, offline contact and exportable records.
E. Loss containment: freeze Keel-originated future mandates, revoke agent permissions, isolate compromised keys and preserve evidence. A freeze cannot reverse completed payments or guarantee issuer/card network blocks.
F. Recovery: documented provider escalation, evidence export, dispute workflow and key recovery.
G. Stress tests: bank outage, issuer insolvency, stablecoin depeg, redemption suspension, chain congestion, bridge exploit, telecom outage, lost card, compromised phone, AI-agent abuse, payment processor failure and currency controls.

Never label any asset "safe" or "guaranteed". Display known, unknown and unverified conditions separately. Keel does not insure deposits or guarantee stablecoin redemption.

## 7. Digital currency and AI-agent future
Keel should be currency-neutral, not token-centric. Support evidence and policy for fiat deposits, e-money, regulated tokenised deposits, central-bank money/CBDC where legally available, regulated stablecoins, and other digital assets only where lawful. No proprietary Keel coin is required.

Every instrument has issuer, legal claim, reserve/settlement model, redemption right, jurisdiction, freeze/blacklist capability, network, transfer finality, fees and counterparty dependencies. Never assume 1 token equals 1 unit of fiat in all conditions. No automatic yield, staking, lending, bridging or FX conversion in the initial product.

AI agents are delegated actors, never owners of the user's money. Each agent receives a versioned mandate with purpose, payees, currency, caps, duration, velocity, permitted rails and human approval thresholds. Agent cannot mint authority, increase its own limits, change recovery trustees, override a hold, or approve its own exception. Human presence or physical-card cryptographic signature is required for high-risk actions under user-configured policy. AI is advisory; deterministic rules and explicit authority decide.

## 8. Payment architecture
Human Card device + user identity → Mandate Registry → Financial Resilience Map → trusted availability engine → atomic reservation → deterministic payment decision → licensed issuer/provider adapter → payment lifecycle → double-entry ledger/reconciliation → verifiable evidence receipt.

Card lifecycle and money lifecycle are separate. Card delivery does not mean money is loaded. Virtual activation does not mean funds exist. Authorisation is not capture; capture is not settlement; settlement is not reconciliation. Offline card acceptance can create delayed authorisation and double-spend/chargeback exposure; do not enable it without issuer/network risk controls and limits.

## 9. Business model
Potential sustainable revenue, subject to partner contracts and local law:
- consumer membership for resilience dashboard, card control, records and recovery tools;
- transparent physical card/device and replacement fee at cost-plus pricing;
- optional premium family/household authority and recovery administration;
- institutional SaaS/API fees for mandate, availability, reconciliation, risk and evidence control;
- integration, certification and support fees for banks, MTOs, issuers, custodians and wallet platforms;
- disclosed partner revenue share for card programmes only where permitted and without steering users into unsafe assets.

Do not base the business on lending customer funds, undisclosed float yield, token appreciation, forced staking, proprietary token sales, spread extraction hidden from users or custody of customer money. Consumer protection and financial resilience must not be undermined by revenue incentives.

## 10. What Keel is not
Not a bank, deposit insurer, central bank, card scheme, issuer, custodian, exchange, MTO, insurer, lender, investment fund or emergency cash guarantee. No claim that decentralisation prevents insolvency, government restrictions, fraud, market loss, protocol exploits or loss of private keys. Keel cannot guarantee that a payment rail remains open during systemic collapse.

## 11. Nigeria and cross-border regulatory boundary
Nigeria is a possible design/market context, not a blanket permission. The CBN's 2026 non-security virtual-asset guidelines describe risk-based licensing/supervision for issuance, distribution, conversion, custody, transfer, redemption and settlement of non-security virtual assets, including stablecoins and deposit money tokens, with consumer-protection, prudential, AML/CFT and operational-resilience requirements. The 2026 Presidential Executive Order coordinates oversight; it does not create a new regulator or remove existing statutory mandates. A local legal opinion must map each activity and partner role before pilot. Card issuance, stored value, payment services, custody, exchange and stablecoin activity must be assessed separately.

## 12. Technical work programme
Phase 1 — physical identity foundation: device registry, card delivery state, challenge nonce, public-key/certificate registry, anti-replay, pairing, revocation, replacement and recovery trustees. No real payment credential.
Phase 2 — mandates and availability: persistent versioned mandates, trusted source adapters, verified financial positions, row-locked reservations, idempotency and concurrency tests.
Phase 3 — human card sandbox: in-app state shows card order/dispatch/delivery/pairing/recovery/virtual eligibility; virtual remains locked until physical-first checks pass.
Phase 4 — financial resilience: account/wallet/asset inventory, legal claim classification, provider concentration, liquidity/redemption conditions, stress scenarios and user exports.
Phase 5 — ledger/remittance: double-entry subledger, payment lifecycle, MTO/wallet/card provider events and reconciliation.
Phase 6 — partner issuance: issuer/BIN sponsor/programme manager, scheme certification, tokenisation, PCI scope assessment, card personalisation and issuer sandbox.
Phase 7 — limited live pilot: local legal opinions, security assessment, independent hardware review, penetration test, incident/dispute/recovery runbooks and operational support.

## 13. Mechanical acceptance tests
- Virtual activation is impossible until delivery, verified physical challenge, hardware attestation, tested recovery, active mandate and trusted funding-source checks all pass.
- Browser-submitted booleans cannot satisfy trusted verifier requirements.
- Pairing challenge is one-time, expiring, principal/card/session bound and replay-resistant.
- Replayed challenge, revoked certificate, counter rollback, replaced card or cross-tenant device binding fails closed.
- Private key, seed phrase, PAN, CVV, PIN and biometric templates never enter Keel database/logs/API.
- Loss of physical card locks future high-risk authorisations; in-flight payment exposure remains visible.
- Recovery requires threshold/time-delay and user alerts; no unilateral silent admin reset.
- AI agent cannot expand its mandate, add a payee, change recovery or override a hold.
- Asset positions identify issuer/custodian/jurisdiction/redemption; unknown fields remain unknown.
- Stablecoin depeg, redemption freeze, bank outage and network outage stress scenarios produce explicit warnings, not "safe" claims.
- Financial records are exportable and independently verifiable; Keel outage must not destroy user's only copy of evidence.
- All monetary calculations use integer minor units; no cross-currency netting without approved FX evidence.
- Card and ledger state transitions preserve the difference between authorisation, capture, settlement and reconciliation.

## 14. Novelty and evidence discipline
Physical secure elements, non-exportable keys, smart cards, tokenised payments, self-custody wallets, multi-provider payment apps and crypto-linked cards already exist. Keel must not claim invention of those parts. Potential differentiation to test is the combined physical-first human authority anchor + independent financial resilience map + provider-neutral verified availability/reservation + cross-rail lifecycle/evidence + recovery governance, designed to preserve user agency without making Keel custodian. Novelty requires a separate prior-art/patent search and implementation evidence. The current code is a policy prototype, not a cryptographically verified hardware system.

## 15. Release gates
No public user-facing payment claim until the physical hardware, device attestation, recovery, issuer contract, card scheme approvals, legal role, PCI scope, source trust, atomic reservations, balanced ledger, dispute operations and resilience controls have passed independent review. Sandbox card profiles remain explicitly non-payment.
