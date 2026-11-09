# Keel Human Digital Card & Financial Continuity Architecture

**Document status:** Architecture specification — proposed target design  
**Repository baseline:** `main` as inspected 9 November 2026; consumer card security/recovery tranche merged through PR #17  
**Implementation status:** Physical-card identity, signed partner-event, attestation/delivery evidence, cryptographic pairing and recovery foundations exist in source. No production card partner, hardware verifier, carrier, issuer, custodian or payment processor is connected. No card has been manufactured, delivered or activated. No real-money payment or offline value movement is implemented.  
**Release rule:** This document does not authorise migration application, production deployment, card issuance, custody, lending, payment execution or public claims of financial protection.

---

## 1. Product definition

**Keel Human Digital Card** is the human-facing access instrument for the Keel Financial Continuity Platform. It is not designed as a standalone debit card, a new currency, a bank account, or a promise that money remains accessible when every underlying institution is unavailable.

Its purpose is to let a person express and enforce their financial authority across supported providers and channels, understand the actual state and limits of their money, and retain bounded access and evidence when one provider or route fails.

The card has two coordinated forms:

- **Physical Human Card:** a secure-element-backed hardware credential and the user's initial root-of-trust ceremony.
- **Virtual Human Card:** issuer/network-issued payment credentials or network tokens, provisioned only after the physical-first gates and all financial/issuer gates are satisfied.

Both are expressions of the same human identity, policy and authority relationship. They are not interchangeable secrets and must not share a private key.

### 1.1 Governing principle

> AI may advise. Keel may evaluate and enforce a human-issued mandate. Regulated institutions and payment networks may execute. The human remains the source of personal financial authority.

A human may explicitly create narrow, revocable mandates for bounded recurring or low-risk actions. An AI agent may act only within that mandate. It cannot create, enlarge, renew, or approve its own authority.

### 1.2 What Keel can and cannot promise

Keel is designed to reduce dependence on a single provider, expose uncertainty, preserve evidence, support bounded fallback routes and improve recovery coordination.

Keel cannot promise that a card will always work, that all funds are immune to insolvency, that an offline terminal can dispense cash without a funded programme, or that a digital record alone establishes legal ownership or priority.

---

## 2. System boundaries and actors

### 2.1 Actors

- **Cardholder / human principal:** owns personal mandates, sets limits, approves actions and can revoke authority.
- **Keel control plane:** identity binding, mandate evaluation, state assessment, policy, evidence, orchestration and recovery coordination.
- **AI Financial Guardian:** advisory and bounded agent interface; never a root authority.
- **Physical-card manufacturer / personalisation bureau:** manufactures and injects or provisions the secure-element credential under audited controls.
- **Independent hardware attestation verifier:** verifies device class, secure-element identity, applet/firmware measurements and certificate status.
- **Independent delivery verifier:** provides evidence that the physical card reached the intended recipient under an approved process.
- **Licensed issuer / programme manager:** issues card credentials, manages scheme/network authorisation and issuer-side blocking.
- **Custodian / safeguarding institution:** legally holds funds or assets under a disclosed arrangement.
- **Payment processor / card network / bank / wallet / remittance provider:** executes and settles the relevant transaction.
- **Merchant / ATM operator / offline terminal:** accepts a payment or provides cash only under a contracted acceptance and liability model.
- **Recovery trustees:** independently verified persons who can participate in the cardholder's configured recovery quorum.

### 2.2 Trust separation

No single Keel operator, AI model, manufacturer, issuer, custodian, delivery company or recovery trustee should be able to silently create a usable card and move money.

Separate duties for:
1. human identity proofing;
2. card personalisation;
3. hardware attestation;
4. physical delivery;
5. cardholder pairing;
6. issuer credential provisioning;
7. funding and reserve confirmation;
8. payment authority;
9. provider execution and settlement;
10. reconciliation and independent assurance.

A signed webhook proves that a configured key signed an event; it does not prove the underlying event is true. Verifier accreditation, key custody, evidence scope and audit quality require independent due diligence.

---

## 3. Physical-first provisioning and activation

### 3.1 Mandatory lifecycle

`ORDER_REQUESTED → IDENTITY_VERIFIED → PERSONALISATION_PENDING → PERSONALised → HARDWARE_ATTESTED → DELIVERY_VERIFIED → DELIVERED_PENDING_PAIRING → PHYSICALLY_PAIRED → RECOVERY_READY → FUNDING_READY → ISSUER_ELIGIBLE → ISSUER_PROVISIONED → VIRTUAL_ACTIVE`

The canonical implementation must use normalised uppercase state names in the eventual state machine; the mixed-case label above is explanatory only.

The physical card must be delivered, independently verified and cryptographically paired before a virtual payment credential can be provisioned or activated. A virtual app surface may exist earlier only in **restricted setup mode**: it may show order status, safety education and pending requirements, but cannot reveal a spendable credential, create a payment token or initiate a payment.

### 3.2 Gate conditions

- Identity proofing is current and performed by an accepted independent provider.
- Card personalisation event is authenticated, fresh, idempotent and bound to the order.
- Hardware attestation is current, independently verified and bound to the exact public-key fingerprint.
- Delivery evidence is independent, fresh and bound to the exact order/card reference.
- Pairing challenge is single-use, short-lived, nonce-bound, card-bound and counter-bound.
- Physical secure element signs the challenge using its non-exportable private key.
- Pairing counter is monotonic and transactionally checked; stale or repeated counters fail closed.
- Recovery group is established and independently tested, or an explicitly approved alternative recovery process is accepted.
- Issuer programme eligibility and legal disclosures are satisfied.
- A regulated issuer has provisioned the virtual credential.
- A trusted source confirms the funding arrangement and payment availability model.
- Spend mandate, device binding, authentication and policy are ready.

Passing Keel's lifecycle gate means **eligible for issuer review**, not that Keel itself has issued a payment credential.

### 3.3 Credential separation

- Physical secure element: non-exportable Ed25519 identity/pairing key or a hardware-supported scheme selected after cryptographic review. Ed25519 pairing does not itself implement EMV payment cryptography.
- Phone/device: device-bound key for app authentication and virtual-card control; separate from the card key.
- Issuer/network: payment token and cryptographic material provisioned and managed by the issuer/network. Keel should receive opaque references and status events, not PAN/CVV/PIN or scheme secrets.
- Recovery: recovery authorises revocation and replacement; it never reconstructs or exports the old card private key.

The existing Ed25519 pairing foundation must not be misrepresented as EMVCo certification, secure-element certification or a payment credential.

---

## 4. Physical Human Card design

### 4.1 Hardware target

Candidate hardware capabilities, subject to manufacturer selection and independent evaluation:

- certified secure element with non-exportable keys and anti-rollback protections;
- NFC interface for card-present interactions;
- optional BLE for proximity and status exchange, disabled or privacy-preserving by default;
- optional e-ink or low-power display for amount/payee/approval context, only if power, tamper and accessibility requirements justify it;
- tactile confirmation / cancel controls where the chosen hardware supports secure input;
- optional biometric sensor only after privacy, liveness, false-accept/false-reject and coercion risks are independently assessed;
- tamper-evident enclosure and controlled manufacturing/personalisation;
- signed firmware/applet updates with version pinning, rollback protection and a documented vulnerability response process.

A display is not a trust anchor. The secure element and trusted user-verification path must protect the transaction context. A malicious phone must not be able to display one payee while signing another.

### 4.2 Cardholder interaction

For an online transaction:
1. merchant/issuer presents a payment request through an approved channel;
2. Keel obtains a canonical request from a trusted provider adapter;
3. cardholder sees payee, amount, currency, fees, funding source, channel and relevant risk;
4. policy determines whether the action is blocked, requires approval or falls within a pre-authorised mandate;
5. high-risk or out-of-mandate action requires a fresh human approval;
6. the approved request is fingerprinted and passed to the issuer/provider;
7. final authorisation/capture/settlement status is later reconciled.

For an offline transaction, the terminal and secure element must support the separately specified Offline Value Allocation protocol. A physical button alone does not prove the person understood the transaction; user-verification and trusted display requirements need usability and security testing.

### 4.3 Lost, stolen or compromised card

- User can request immediate local Keel lock.
- Keel writes a durable outbox request to issuer/programme partner.
- UI distinguishes **Keel locked**, **issuer request pending**, **issuer acknowledged**, and **network block confirmed**.
- No UI may claim network-wide lock until the issuer acknowledges the relevant action.
- In-flight authorisations, captures, clearing and settlement remain visible as residual exposure.
- Replacement requires new personalisation, attestation, delivery, pairing and issuer provisioning. Old private key is never restored.

---

## 5. Virtual Human Card

The virtual card is an issuer/network credential, not a PAN invented by Keel. Preferred integrations are issuer tokenisation and network token services with device binding, merchant controls and lifecycle events.

### 5.1 Virtual card modes

- **Setup restricted:** no spend credential; physical delivery/pairing incomplete.
- **Issuer pending:** Keel gates passed; issuer has not provisioned.
- **Active online:** issuer credential provisioned; payment authority and availability checks apply.
- **Limited mandate:** narrow recurring/low-risk activity may proceed within explicit human-created constraints.
- **Human approval required:** transaction paused for the cardholder.
- **Hold:** source data, identity, device or provider state is stale, conflicting or uncertain.
- **Locked:** local Keel policy or cardholder lock blocks new Keel-originated instructions; issuer status is separately displayed.
- **Issuer blocked/revoked:** issuer confirms the network-side credential state.
- **Recovery pending:** new payment authority is blocked pending recovery process.
- **Offline allocation only:** only approved offline value and terminal protocol may be used; this is not a representation of the full account balance.

### 5.2 Transaction controls

Per transaction or mandate:
- amount and currency;
- merchant/payee identity and category;
- channel and country/region;
- funding source;
- one-time, recurring and aggregate limits;
- time window and expiry;
- subscription and merchant-initiated transaction rules;
- ATM/cash access;
- online/offline eligibility;
- agent identity and purpose;
- human approval threshold;
- risk and provider-state conditions.

Merchant category codes are not a complete semantic description of a purchase. Where the merchant identity or purpose is uncertain, Keel must disclose uncertainty rather than pretend the category is exact.

### 5.3 Dynamic credentials

Use issuer-supported network tokens and lifecycle controls. Dynamic CVV or cryptograms must be generated and handled by the issuer/network-approved component, not improvised by Keel. Token lifecycle, device binding, wallet provisioning, card-on-file, recurring payments, refunds, disputes and chargebacks require scheme/issuer integration and certification.

---

## 6. Human Authority Engine

The Authority Engine is the policy root for the cardholder's own financial activity.

### 6.1 Authority model

Every delegated action must bind:
- principal identity and authentication assurance;
- agent/workload identity;
- mandate ID and immutable version;
- allowed channel and funding source;
- payee/merchant/category and purpose;
- instrument and currency;
- per-transaction and aggregate limits;
- validity period and expiry;
- approval threshold;
- revocation status;
- exact payment-intent fingerprint.

The agent cannot alter any of these fields. A material change to payee, amount, currency, fees, funding source or channel invalidates the previous approval.

### 6.2 Decisions

- `ALLOW_WITHIN_MANDATE`: narrowly pre-authorised action may proceed to provider authorisation, subject to atomic reservation and provider controls.
- `HUMAN_APPROVAL_REQUIRED`: pause and present a complete approval receipt.
- `HOLD`: missing, stale, conflicting, disputed or unavailable evidence; no payment instruction.
- `DENY`: outside authority, revoked, prohibited or over limit.

A Keel decision is not a card-network authorisation, issuer approval, funds transfer or settlement.

### 6.3 Non-overridable invariants

- Human rejection cannot be overridden by AI, operator or retry logic.
- AI cannot grant itself permission, change limits, change payee allowlists or disable review.
- A user-created mandate can be revoked at any time subject to in-flight transaction realities.
- No borrowing or credit extension is implied by a card mandate.
- No mandate may spend unverified or unavailable funds.
- Emergency/collapse mode cannot be activated solely by an AI prediction. It requires verified trigger policy and human/authorised operational governance.

---

## 7. AI Financial Guardian

AI is an advisory and bounded orchestration assistant, not a custodian, risk guarantor or autonomous financial authority.

### 7.1 Permitted functions

- explain verified balances, holds, pending transactions and uncertainty;
- detect unusual spending and anomalous merchant/device patterns;
- flag provider outage, concentration, settlement delay and liquidity signals;
- compare supported payment routes and their fees/risks;
- prepare but not self-approve payment requests;
- identify recurring subscriptions and upcoming obligations;
- assist with dispute/recovery evidence preparation;
- explain currency exposure and source timestamps;
- alert on agent mandate drift or attempted privilege escalation;
- recommend a fallback route where the route is contractually and technically available.

### 7.2 Prohibited functions

- create or enlarge its own mandate;
- approve an action when human approval is required;
- override a human rejection;
- create credit, borrow or pledge assets;
- transfer, withdraw, redeem or release assets without a valid human/organisational mandate and regulated provider path;
- treat a predicted bank failure as proof of insolvency;
- declare funds safe or protected without source evidence and legal basis;
- represent a stale snapshot as live spendable value;
- silently change the cardholder's fallback provider or currency.

### 7.3 Evidence display

Every AI-derived statement must distinguish:
- observed source fact;
- independently verified fact;
- deterministic calculation;
- AI inference;
- simulation;
- unknown or stale information.

The UI should show source, as-of time, confidence/quality and what the evidence does not establish. AI explanations are not proof objects.

---

## 8. Financial state, ledger and availability

This is a prerequisite to any live card spending or offline value feature.

### 8.1 Separate financial states

Keel must separately represent:
- reported/provider-displayed balance;
- posted ledger balance;
- settled balance;
- pending incoming funds;
- pending outgoing funds;
- holds and authorisations;
- obligations and commitments;
- restricted or disputed amounts;
- verified reserve/custody amount;
- legally available amount where that can be established;
- active Keel reservations;
- offline value allocation;
- provider exposure and concentration;
- available-to-spend amount.

Do not use one field called `balance` for these concepts.

### 8.2 Double-entry ledger

A production ledger must provide:
- chart of accounts and account ownership/tenant;
- journal entries and balanced debit/credit lines per currency;
- immutable posted entries;
- reversals via compensating journal, never edits to posted history;
- exact integer minor units with explicit currency exponent;
- idempotency keys and external references;
- transactional posting and atomic reservation;
- period close, reconciliation and audit exports;
- source evidence and correction lineage;
- concurrency and duplicate-submission protection.

PostgreSQL numeric integer precision or integer strings are required; JavaScript money calculations use BigInt. Never use floating-point arithmetic for money.

The existing financial-state and currency modules are object/availability and simulation foundations, not a production double-entry customer-money ledger.

### 8.3 Availability rule

For a single account scope and currency:

`available_to_spend = verified_eligible_settled_funds - restrictions - due_obligations - policy_reserves - provider_holds - active_reservations - offline_allocations`

Every component must have source, freshness, currency, effective time, evidence class, reconciliation state and legal/operational meaning. Avoid double subtraction where a provider's reported available balance already incorporates a hold. When the relationship is unclear, HOLD.

A cryptographic hash or proof of a historical balance does not establish that money still exists, remains unencumbered, is legally owned by the customer or is redeemable now.

---

## 9. Protected funds and reserve architecture

### 9.1 Legal and operational structure

Keel should initially be a control/evidence platform and use regulated partners for custody, safeguarding, issuing and settlement. A Keel database entry does not create a trust, escrow, deposit, fiduciary relationship or insolvency-remote arrangement.

Before any consumer funds are represented as protected, counsel must confirm:
- who legally owns the funds;
- whether funds are held on trust, safeguarded, escrowed or as a deposit;
- whether the arrangement is segregated from the custodian's own assets;
- insolvency treatment and customer claim priority;
- deposit guarantee eligibility and limits, if any;
- withdrawal/redemption rights and service-level terms;
- fees, FX, settlement and liquidity arrangements;
- whether multiple providers are legally and operationally independent;
- whether the card issuer depends on the same bank/custodian that may fail.

### 9.2 Reserve provider model

Potentially support multiple independent custodians/issuers where lawful and commercially viable. Diversification is not achieved by multiple brands that depend on the same banking group, settlement bank or processor. Model beneficial ownership, group exposure, jurisdiction, asset type, redemption windows, concentration and operational dependencies.

The interface must distinguish:
- customer-owned funds at named regulated custodian;
- issuer settlement prefunding;
- Keel offline allocation;
- pending/unsettled funds;
- provider operating liquidity;
- emergency liquidity facility;
- uninsured or disputed exposure.

Never imply that the Keel reserve is an insurance fund or government guarantee unless a legally binding programme actually provides that protection.

### 9.3 Provider failure response

A provider failure workflow must:
1. identify the exact provider and affected services;
2. freeze unsupported availability assertions;
3. distinguish service outage from formal resolution/insolvency;
4. capture verified source notices and timestamps;
5. identify customer asset location and legal arrangement;
6. calculate exposure without double counting;
7. stop new instructions through failed or uncertain routes;
8. show alternative routes only if independently available and authorised;
9. preserve in-flight transaction state;
10. coordinate claims, transfer or recovery through authorised parties;
11. keep the customer informed of uncertainty and expected next updates.

No AI-generated “bank collapse” score may itself trigger movement of customer funds.

---

## 10. Keel Offline Value Allocation (KOVA)

KOVA is a proposed bounded offline payment capability. It is not implemented and must not be described as a live feature.

### 10.1 Core rule: prefunded value, not an offline promise

While online, a licensed issuer or legally authorised reserve custodian allocates a fixed amount of already-funded value to an offline purse or programme liability account. The allocation is recorded in Keel's ledger and deducted from online available-to-spend. A signed allocation certificate binds:
- card secure-element identity;
- allocation ID and currency;
- maximum value and transaction count;
- policy and protocol version;
- allowed merchant/terminal classes;
- validity and risk parameters;
- issuer/custodian liability reference;
- key ID and signature.

The secure element must protect the offline purse state and monotonic counters. Keel does not mint money or turn an ordinary account balance into a guaranteed offline claim.

### 10.2 Offline acceptance flow

1. Online issuer/custodian authorises and prefunds a bounded allocation.
2. Keel reserves/debits the amount from the online spendable pool.
3. Issuer/custodian signs allocation certificate.
4. Certificate is loaded into the attested physical secure element.
5. Approved terminal presents signed merchant/terminal identity and transaction request.
6. Cardholder confirms the amount/payee through a trusted channel.
7. Secure element checks certificate, local counters, policy, expiry and remaining value; signs a transaction record.
8. Terminal verifies card and allocation signatures, terminal certificate, local limits and its own acceptance budget.
9. Terminal records a tamper-evident receipt and marks the allocation spend locally.
10. Terminal/card synchronise when connectivity returns.
11. Keel reconciles allocation, transaction and terminal records; unused value is released only after authoritative reconciliation.

### 10.3 Offline risk constraints

During a network partition, two disconnected terminals cannot know that the same allocation was already spent at another disconnected terminal. A mesh can distribute spent-state updates when connected, but it cannot provide global consistency while partitions remain disconnected.

Therefore:
- offline transaction amount and cumulative allocation must be low and bounded;
- offline acceptance requires explicit risk/liability rules;
- terminal acceptance budget and card allocation budget must both be enforced;
- use secure-element anti-rollback, transaction counters, device certificates and signed receipts;
- terminal and card must have expiry/clock assumptions explicitly assessed;
- if trustworthy time is unavailable, use bounded counters and allocation epochs with conservative limits;
- offline mode should expire or require reconnection after a short policy window;
- offline terminals must refuse when certificate, clock, counter or state is uncertain;
- reconcile conflicts into a disclosed loss/chargeback/liability process, not silent balance correction.

A ZK proof can disclose a limited eligibility fact without revealing the underlying data. It cannot prove that a disconnected allocation has not been spent elsewhere, that a bank remains solvent, or that funds remain legally available.

### 10.4 Offline cash / ATM boundary

An offline ATM cannot dispense cash merely because a card shows an old balance or possesses a proof. It requires:
- physical cash inventory;
- an ATM operator willing to accept the instrument;
- a prefunded and contractually allocated liability/guarantee;
- offline terminal certification and key management;
- cash-dispenser and tamper security;
- enforceable transaction/withdrawal caps;
- offline dispute and loss allocation;
- subsequent reconciliation and settlement.

No “emergency cash guarantee” should be advertised until a licensed issuer, custodian and ATM operator contractually fund and operate the service.

### 10.5 Mesh and communication

Local NFC/BLE/QR/Wi-Fi may be appropriate for terminal interactions subject to certification and threat analysis. A low-bandwidth radio such as LoRa may carry small status/alert messages but should not be assumed suitable for secure payment payloads or ATM integration. Mesh communication is a resilience aid, not a substitute for settlement or a global ledger.

---

## 11. Keel Continuity Network

The Continuity Network is a coordinated set of independently operated, contractually authorised fallback routes. It is not an unpermissioned network of arbitrary ATMs.

### 11.1 Logical layers

1. **Human Authority Layer:** identity, mandates, approvals, revocation and recovery.
2. **Card Credential Layer:** physical secure element and issuer-managed virtual token.
3. **Keel Control Plane:** policy, source validation, availability, route selection and evidence.
4. **Financial Provider Layer:** banks, issuers, custodians, wallets, remittance providers and regulated digital-money issuers.
5. **Offline Value Layer:** KOVA allocations, certified terminals and offline liability budget.
6. **Continuity Coordination Layer:** provider health, route availability, incident coordination and controlled fallback.
7. **Reconciliation & Recovery Layer:** ledger, provider statements, disputes, claims and recovery evidence.

### 11.2 Decentralisation meaning

Keel can decentralise:
- human-held authority and device keys;
- independent verification;
- provider/custodian relationships;
- governance and audit;
- local bounded offline acceptance;
- evidence replication and recovery coordination.

It cannot decentralise away the legal issuer, custody, redemption, cash inventory, settlement finality or jurisdictional controls of fiat money. A distributed network is not automatically a legally independent reserve.

### 11.3 Failure modes

- **Mobile app unavailable:** use approved alternate access channel; no false balance.
- **Keel control plane unavailable:** no new online instructions unless an independently validated safe-mode protocol exists; previously provisioned KOVA may continue within limits.
- **Issuer unavailable:** no new issuer-authorised online card payments; KOVA only if separately funded and valid.
- **Bank/custodian outage:** show last verified state with timestamp, suspend unsupported availability, use alternate provider only if funds and authority are independently confirmed.
- **Processor/network outage:** use another supported route only if merchant, issuer, mandate and funds support it.
- **Connectivity partition:** local offline purse/terminal limits apply; no global double-spend guarantee.
- **Formal insolvency/resolution:** freeze affected route, preserve evidence and follow legally approved claims/transfer process.
- **Card/device compromise:** revoke card and credentials through issuer and Keel; reconcile in-flight transactions.
- **AI outage or model failure:** deterministic policy and human controls remain; AI is not required for payment authority.

---

## 12. Multi-asset and AI-agent interoperability

The architecture should be channel- and instrument-neutral but not asset-agnostic in its risk treatment.

Potential future integrations:
- bank deposits and payment accounts;
- card network tokens;
- regulated e-money and stored value;
- regulated stablecoins;
- tokenised deposits;
- CBDCs where available;
- licensed remittance rails;
- approved wallet providers;
- machine-to-machine and AI-agent payment protocols.

For each instrument record issuer, legal claim, redemption right, custody, reserve evidence, freeze/blacklist power, transfer finality, fees, jurisdiction, FX exposure, settlement timing and dispute process.

Do not issue a Keel currency merely to enable interoperability. Do not represent stablecoins, tokenised deposits, CBDCs and bank deposits as equivalent. No digital asset is assumed to redeem at par or be immune from issuer, custodian, protocol or regulatory failure.

AI-agent payments must use the same mandate, spend-envelope, availability, reservation, approval and evidence controls. Agent identity must be cryptographically authenticated; a caller-supplied agent name is not identity.

---

## 13. Security, privacy and assurance

### 13.1 Cryptographic and key management

- Hardware-backed non-exportable card keys.
- KMS/HSM for server signing keys and partner secrets.
- Separate keys per partner, verifier, environment and purpose.
- Rotation, revocation, certificate status, key ceremony and compromise response.
- Canonical serialisation and domain-separated signatures.
- Replay windows, nonces, idempotency and monotonic counters.
- Signed firmware/applet update process and anti-rollback.
- No secrets in logs, analytics, URLs or browser storage.
- Threat model covers malicious phone, compromised merchant terminal, counterfeit card, insider, partner compromise, supply-chain tampering, coercion, side-channel attacks and social engineering.

### 13.2 Privacy

- Data minimisation and purpose limitation.
- Pseudonymous provider identifiers where possible.
- No PAN/CVV/PIN or card private key in Keel.
- No raw biometric template storage by default.
- Do not place personal data in public blockchain or immutable public logs.
- Separate identity data from transaction analytics.
- Define retention, deletion, correction, legal hold and export.
- ZK proofs only where a concrete privacy requirement and sound circuit/protocol exist; do not use ZK as a decorative trust claim.
- Complete privacy impact assessment and country-specific data transfer review before consumer launch.

### 13.3 Security assurance

Required before production:
- secure-element and applet assessment;
- hardware supply-chain and personalisation audit;
- independent attestation verifier assessment;
- application/API penetration testing;
- PostgreSQL RLS/tenant isolation and privilege review;
- concurrency, race and replay testing;
- key management and rotation drills;
- mobile app/device security testing;
- issuer/network integration certification;
- offline terminal certification and adversarial testing;
- backup/restore and disaster recovery;
- incident response and customer support exercises;
- independent financial control and reconciliation review.

---

## 14. Regulatory and commercial gates

Regulatory treatment depends on the exact product, funds flow, contractual roles and launch jurisdiction. Before any live service, local counsel and regulated partners must map:
- issuer/programme-manager responsibilities;
- payment services, e-money, stored value and money transmission;
- safeguarding/custody/trust/escrow;
- AML/CFT, sanctions and customer due diligence;
- consumer disclosures, complaints, refunds and unauthorised payment liability;
- card scheme, PCI DSS and issuer certification scope;
- privacy, data localisation and cross-border transfers;
- stablecoin/digital asset rules where relevant;
- ATM/offline cash and agent-network requirements;
- outsourcing, operational resilience and incident notification.

A partner's licence does not automatically authorise Keel to perform every function. The contract must identify the regulated entity, responsibility matrix, service levels, customer claim, liability, dispute route and data controller/processor roles.

---

## 15. State and data model target

The existing consumer card schema is a useful first tranche. It is not the full payment-card or financial-continuity data model.

Target bounded contexts:

- **Consumer identity:** identity provider, assurance level, expiry, pseudonymous subject mapping, session/device binding.
- **Card lifecycle:** order, card, hardware model, attestation, delivery, pairing, counters, issuer programme, lifecycle state.
- **Credentials:** opaque issuer token reference, token requestor, device binding, issuer state, activation and revocation events. No PAN/CVV.
- **Human authority:** mandate, version, principal, agent, scopes, spend envelope, revocation.
- **Financial ledger:** accounts, journal headers, balanced lines, holds, reservations, reversals, reconciliation.
- **Reserve/custody:** custodian, legal arrangement, asset, beneficial-owner mapping, segregation evidence, confirmation, concentration and insolvency disclosures.
- **Payment lifecycle:** intent, decision, approval, provider instruction, authorisation, capture, clearing, settlement, refund, dispute and reconciliation.
- **Offline value:** allocation, certificate, card counter, terminal, terminal budget, signed transaction, sync event, conflict and liability.
- **Continuity:** provider dependency graph, health evidence, outage/incident, route eligibility, fallback decision and recovery case.
- **Evidence:** source provenance, verification class, timestamp, signature, immutable event lineage and exportable dossier.

Tenant and consumer access must be enforced in database constraints and service layer. Use composite foreign keys and RLS or equivalent defence-in-depth. All multi-row financial mutations must be atomic. Outbox writes and state transitions occur in the same database transaction; provider calls happen outside transactions and responses return through authenticated inbox processing.

---

## 16. User experience and cardholder screens

1. **Card home:** physical/virtual status, issuer status, lock status, provider health and as-of timestamp.
2. **My money:** reported, settled, reserved, restricted, pending and available values shown separately by currency and provider.
3. **Approval inbox:** payee, amount, currency, fee, funding source, purpose, channel, risk flags, expiry and exact approve/reject action.
4. **AI Guardian:** explanations and alerts labelled by evidence class; no hidden automatic approvals.
5. **Provider resilience:** service status vs formal resolution status; affected funds and route limitations.
6. **Offline purse:** prefunded allocation, remaining offline budget, validity, last sync and explicit double-spend/liability disclosure.
7. **Recovery centre:** card lock state, issuer acknowledgement, trustee quorum, delay, replacement and unresolved transactions.
8. **Activity/evidence:** intent, approval, issuer authorisation, capture, clearing, settlement and reconciliation shown as distinct events.
9. **Privacy/security:** devices, sessions, mandates, agent access, data sharing and revocation.
10. **Support/disputes:** provider contact, complaint and dispute status; never imply Keel can reverse a completed transfer.

Accessibility requirements include screen-reader labels, non-colour-only status, clear currency/decimal display, local language support, large text, low-bandwidth mode and safe handling of shared devices.

---

## 17. Mechanical acceptance tests

These are release gates, not marketing examples.

### Physical-first lifecycle
- Virtual credential provisioning request before delivery evidence → reject.
- Delivery evidence without valid hardware attestation → reject.
- Attestation for a different public-key fingerprint → reject.
- Replayed/expired pairing nonce → reject.
- Replayed or lower monotonic counter → reject.
- Pairing success without current independent recovery readiness → not eligible for virtual issuer provisioning.
- Keel eligibility without issuer acknowledgement → UI remains issuer-pending, never active.

### Human authority and AI
- Human rejects payment → no retry or AI override can proceed.
- AI attempts to enlarge its mandate → reject and record security event.
- Payee, amount, currency, fee or funding source changes after approval → approval invalid.
- Mandate revoked during pending intent → no new instruction; reconcile any already submitted request.
- Required approval unavailable → HOLD.
- Agent identity unverified → DENY/HOLD according to policy; never infer identity from a label.

### Financial state and ledger
- Reported balance only → not spendable.
- Stale or unreconciled source → HOLD.
- Missing encumbrance or legal ownership evidence → not eligible for protected availability.
- Duplicate collateral/funds source → no double count.
- Two concurrent reservations exceed capacity → at most one succeeds; ledger and reservations remain balanced.
- Posted journal modified/deleted → database rejects; reversal uses compensating journal.
- Same idempotency key submitted twice → one logical effect.
- Cross-currency addition without approved FX valuation → reject.

### Issuer and provider failure
- Keel lock written but issuer has not acknowledged → UI says issuer block pending.
- Issuer unavailable → no claim of online card authorisation or network block.
- Provider timeout after submission → UNKNOWN; reconcile before retry.
- Formal resolution notice absent but app outage exists → do not label provider insolvent.
- Alternate route without independently confirmed funds/mandate → unavailable.

### Offline value
- Allocation not prefunded/issuer-signed → terminal rejects.
- Allocation expired, exhausted, revoked or wrong card → reject.
- Terminal not certified/allowlisted → reject.
- Secure-element counter rollback → reject.
- Same allocation spent at two disconnected terminals → detect conflict on sync, invoke disclosed liability process; do not claim global prevention.
- Offline budget exhausted → reject even if online balance is higher.
- Offline ATM cash request without funded operator programme → reject.
- Reconnection with duplicate receipt → idempotent reconciliation, no duplicate posting.
- Unused allocation release before authoritative reconciliation → reject.

### Privacy and security
- PAN/CVV/PIN/private card key appears in Keel storage/logs → release blocker.
- Unauthenticated cross-consumer card lookup → deny.
- Partner webhook wrong signature, stale timestamp or duplicate event → reject.
- Trustee is owner, unverified, duplicated or already responded → reject.
- Recovery approval uses configured delay snapshot, not a hard-coded delay.
- Audit event update/delete → database rejects.
- Secrets exposed in logs or browser storage → release blocker.

---

## 18. Delivery sequence and release gates

### Phase 0 — Architecture and risk baseline
- Approve this specification and threat model.
- Map existing card APIs and lifecycle against this target.
- Resolve any mismatch in configured recovery delay, identity assurance and state naming.
- Define data classification, privacy and operational ownership.

### Phase 1 — Financial truth foundation
- Production-grade double-entry ledger.
- Atomic holds/reservations and idempotency.
- Verified source ingestion and reconciliation.
- Available-to-spend calculation with explicit legal/source semantics.
- PostgreSQL integration and concurrency tests.

### Phase 2 — Authority and online card control
- Human mandate registry and spend envelope.
- Approval service and device-bound authentication.
- Issuer/programme adapter in sandbox.
- Issuer tokenisation, lifecycle, lock acknowledgement and reconciliation.
- Full payment lifecycle and disputes.

### Phase 3 — Reserve and continuity
- Custodian legal/technical integration.
- Customer beneficial ownership and segregation evidence.
- Multi-provider dependency and concentration model.
- Incident, outage, resolution and recovery workflows.
- Operational resilience and disaster recovery.

### Phase 4 — Offline value research and prototype
- Select secure element and terminal platform.
- Formal threat model and liability model.
- Protocol specification and adversarial double-spend tests.
- Small-value prefunded sandbox pilot with issuer/custodian/merchant.
- No ATM cash-out until a separately funded, certified operator programme exists.

### Phase 5 — AI Guardian and agent interoperability
- Evidence-bounded AI explanation.
- Agent identity and constrained mandates.
- Human approval and revocation integration.
- Adversarial prompt-injection and privilege-escalation testing.

### Phase 6 — Independent assurance and controlled launch
- Regulatory counsel sign-off per jurisdiction.
- Issuer/scheme certification and processor contracts.
- Hardware, application, API, privacy and financial control audits.
- Customer support, disputes, complaints, incident and recovery exercises.
- Limited pilot with explicit scope and loss limits.
- Expand only after measured operational evidence.

**No phase may be skipped by adding a UI or by passing unit tests alone.**

---

## 19. Novelty and differentiation discipline

The following are established technology categories and must not be individually claimed as new inventions: secure-element cards, NFC, virtual cards, issuer tokenisation, dynamic card credentials, AI fraud detection, offline stored value, monotonic counters, payment networks, mesh communication, ZK proofs, multi-custodian arrangements and double-entry accounting.

Potential product differentiation lies in the disciplined integration of:
- physical-rooted human authority with issuer-managed virtual credentials;
- consistent mandates across card, bank, wallet and agent channels;
- evidence-class-aware financial availability;
- legally backed, prefunded offline allocations;
- explicit partition-risk and liability handling;
- provider dependency and failure transitions;
- issuer-confirmed lock/recovery status;
- auditable reconciliation from human approval through settlement.

This is a product/architecture hypothesis, not a conclusion of patent novelty. A prior-art search and patent counsel review are required before making invention, first-mover or exclusivity claims.

---

## 20. Current implementation map and known gaps

### Implemented source foundations (not production service)
- Consumer identity and short-lived session foundation.
- Physical card order request and physical-first eligibility state machine.
- Signed partner personalisation, independent attestation and delivery event contracts.
- Ed25519 physical-card pairing and key fingerprint verification.
- Consumer-local emergency lock and security outbox record.
- Trustee-based delayed recovery and non-destructive recovery drill.
- Payment authority deterministic evaluator foundation.
- Financial object/evidence availability assessment foundation.
- Currency and transfer-intent simulation foundation.

### Not implemented / not verified
- Production identity provider and MFA integration.
- Real manufacturer, secure-element applet, attestation authority and delivery partner.
- Issuer/programme manager, EMV/network tokenisation or virtual card provisioning.
- Issuer-side emergency block, outbox dispatcher and issuer acknowledgement.
- Double-entry customer-money ledger and atomic production reservation.
- Legally verified custody/safeguarding/reserve arrangement.
- KOVA offline purse, certified terminal protocol or offline acceptance.
- ATM cash-out programme and funded operator liability.
- Provider health and formal insolvency feeds.
- Production bank, wallet, remittance, CBDC or stablecoin integrations.
- Full PostgreSQL E2E/concurrency, RLS review, penetration test, hardware certification and operational DR.
- Country-specific legal/regulatory approvals.

### Known implementation checks before coding next tranche
- The existing recovery evaluator must honour the request's configured delay snapshot; do not assume the current fixed 24-hour helper is equivalent to a configurable 24–168-hour policy.
- Database migration 011 exists in source but has not been applied to production.
- Existing card security events are append-only at the table trigger level; production access roles and backup/restore controls still need verification.
- Existing payment authority evaluator is non-executing. Its availability input is a server-side trust boundary; client-supplied values must not become authoritative.
- Existing financial-state availability calculation is not proof of legal title, custody, lien priority or insolvency protection.

---

## 21. Forbidden shortcuts

- Do not activate virtual credentials before physical delivery and pairing.
- Do not equate Ed25519 pairing with EMV certification.
- Do not call a historical balance proof proof of current funds.
- Do not label an ordinary bank deposit as insolvency-proof.
- Do not call an offline allocation credit unless a licensed lender underwrites it.
- Do not claim global double-spend prevention across disconnected terminals.
- Do not advertise emergency ATM cash without funded, certified and contracted cash infrastructure.
- Do not let AI initiate collapse mode, transfer funds, increase limits or approve itself.
- Do not store PAN/CVV/PIN or private card keys in Keel.
- Do not issue a Keel token/currency just to make the architecture appear decentralised.
- Do not treat simulations, source tests, signed callbacks or a successful deployment as proof of production readiness.
- Do not deploy migrations or activate financial flows before the relevant gates pass.

**Architecture acceptance:** This specification is the target baseline for the Human Digital Card and Continuity workstream. Engineering implementation must proceed in dependency order, beginning with financial truth (ledger, reservations and verified availability), while retaining the physical-first card lifecycle and human-authority invariants.
