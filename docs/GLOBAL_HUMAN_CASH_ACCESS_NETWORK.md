# Keel Global Human Cash Access Network
## Agent Cash Assurance, Local Liquidity Intelligence and Offline Cash Continuity

**Document status:** Architecture specification — proposed target design  
**Product family:** Keel Financial Continuity  
**Subsystem:** Keel Human Cash Access Network (HCA)  
**Working capability name:** DH-ATM — Distributed Human Cash Access  
**Specification date:** 9 November 2026  
**Scope:** Global core with jurisdiction-specific regulatory, scheme, currency and provider adapters  
**Release status:** Design only. This document does not authorise money movement, agent appointment, cash custody, ATM operation, offline cash-out or production deployment.

---

## 1. Executive definition

Keel Human Cash Access Network (HCA) is a provider-neutral coordination and assurance layer for cash access through regulated ATM operators, licensed agent networks, banking hubs, post offices, merchant cash-at-till programmes and other locally authorised cash-out channels.

Its purpose is to coordinate **who may provide cash, where cash is reported to be available, what cash-out capacity is actually committed, which customer instruction is authorised, what liability backs a degraded-connectivity transaction, and how every payout is reconciled and disputed**.

HCA is not itself a bank, deposit-taker, cash custodian, ATM operator, e-money issuer, payment switch or universal agent-network licence. Keel must operate through appropriately authorised institutions and contractual arrangements in each market.

The design must support three distinct service modes:

1. **Connected Cash Access:** provider-authorised online cash-out with current issuer/provider response.
2. **Degraded-connectivity Cash Access:** bounded payout under a previously issued, funded and legally enforceable Agent Cash Assurance Envelope (ACAE), subject to the sponsor's approved risk model.
3. **Device-Offline Cash Access:** a separately certified protocol using prefunded offline value or an explicitly underwritten deferred claim. This is the highest-risk mode and is not a fallback that may be silently enabled.

The same global domain model applies across markets. Local adapters determine which actors, services, limits, instruments, disclosures, reports and transaction flows are legally permitted.

## 2. Global design principles

### 2.1 Global core, local rules

Keel must not hard-code Nigeria, the United Kingdom, a single currency, a single payment rail, or a single legal concept of escrow into its core.

The global core owns:
- actor and institutional identity references;
- agent and terminal assurance evidence;
- cash and electronic-float observations;
- sponsor commitments and their backing classifications;
- customer authority and transaction intent;
- cash-out reservations and capacity accounting;
- signed transaction evidence and claims;
- settlement, reconciliation and exception states;
- provider dependencies, outage evidence and continuity policy;
- audit lineage and cross-provider interoperability.

Jurisdiction adapters own:
- permitted regulated activities and service definitions;
- principal, agent, master-agent and super-agent roles;
- licensing, registration, appointment and notification requirements;
- customer due diligence, AML/CFT, sanctions and transaction monitoring obligations;
- transaction, daily, weekly and channel limits;
- fee caps, disclosures, receipts and complaint rules;
- safeguarding, trust, escrow, guarantee and insolvency treatment;
- cash reporting, tax, data residency and retention requirements;
- payment-system, terminal and scheme certification;
- local currency exponent, settlement calendar, holidays and FX controls.

A jurisdiction adapter may make a capability unavailable. It may not weaken global security invariants.

### 2.2 Human authority

The customer remains the source of personal financial authority. AI can recommend an agent, explain service status, flag suspicious activity and help prepare a request. It cannot create or enlarge a withdrawal mandate, override rejection, or declare a transaction approved.

### 2.3 Financial truth

Keel must not confuse:
- customer account balance with cash in an agent's till;
- agent cash with electronic float;
- reported cash inventory with independently verified inventory;
- a sponsor guarantee with cash collateral;
- a credit facility with customer-owned funds;
- a signed voucher with proof that physical cash was delivered;
- a historic balance snapshot with current available funds;
- a claim for later reimbursement with final settlement.

### 2.4 Fail closed, explain uncertainty

If identity, authority, funding, agent capacity, terminal status, sponsor capacity or transaction state is stale, missing, contradictory or unverifiable, the relevant mode must be held or rejected. UI must state which evidence is stale or unavailable.

---

## 3. Why this is a real global infrastructure problem

### 3.1 World Bank reference

The World Bank's Digital Financial Services and Risk Management Handbook identifies agent density and liquidity as material issues. Agents need both physical cash and electronic value to serve cash-in/cash-out demand. The handbook describes agents exchanging cash and e-float with branches or other agents, and busy agents using liquidity managers or super-agents for faster replenishment. It also highlights theft of cash float and teller errors.

World Bank agent-network material identifies consumer, operational and AML/CFT risks, including insufficient liquidity, unauthorised fees, lack of receipts, IT failures, service outages, poor agent vetting and inadequate dispute resolution.

Keel's response is not to claim that agent banking is new. It is to create a common assurance and coordination layer that links:
1. agent identity and permitted role;
2. current cash/e-float evidence;
3. customer-authorised cash-out;
4. sponsor-backed capacity where normal online authorisation is unavailable;
5. signed receipt and exception evidence;
6. ledger posting, claims and reconciliation;
7. network-level liquidity intelligence and replenishment.

References:
- World Bank, *Digital Financial Services and Risk Management Handbook*: https://documents1.worldbank.org/curated/en/226461531293264583/pdf/Digital-financial-services-and-risk-management-handbook.pdf
- World Bank, *Agent Networks*: https://digitalfinance.worldbank.org/topics/agent-networks

### 3.2 UK reference

The Bank of England's April 2025 digital-pound offline-payment experiment examined smart cards and smartphones, secure elements, NFC, BLE, offline value transfer, escrow representation and later reconciliation. It reported technical feasibility for the tested approaches, while highlighting double-spend, counterfeit, secure-element compromise, storage, usability, privacy, legal finality and liability issues. The Bank stated that no digital-pound infrastructure was built and no real-money payments were made.

The October 2025 design note says liability and consumer protection would need to be resolved before any device-offline design could be used at scale.

UK cash-access arrangements also include ATMs, Post Office banking, banking hubs and cash-at-the-till models. HCA should therefore integrate with existing cash-access providers rather than assume that every merchant becomes an ATM or that Keel replaces LINK, Post Office, banks or regulated operators.

References:
- Bank of England, *Digital pound experiment report: Offline payments* (10 April 2025): https://www.bankofengland.co.uk/report/2025/digital-pound-experiment-report-offline-payments
- Bank of England, *Design note – Offline payments* (23 October 2025): https://www.bankofengland.co.uk/report/2025/offline-payments-design-note
- UK Parliament, *Access to cash and banking services* (16 March 2026): https://commonslibrary.parliament.uk/research-briefings/cbp-9453/
- LINK, *Strategic Plan 2025–2027*: https://www.link.co.uk/media/y1sjbgpb/link_strategicplan_2025_final_-web.pdf

These are references to a live policy and engineering problem, not evidence of endorsement or adoption of Keel.

### 3.3 Nigeria reference

The Central Bank of Nigeria issued Agent Banking Guidelines on 6 October 2025. Its December 2024 cash-out circular sets specific requirements and limits for agent transactions, including per-customer and per-agent limits, designated agent float accounts, PTSA terminal connectivity and reporting. Those figures and requirements are jurisdiction-specific and may change. Keel must ingest current rules from an authorised compliance owner rather than bake them into global code.

References:
- CBN, *Circular and Guidelines for the Operations of Agent Banking in Nigeria* (6 October 2025): https://www.cbn.gov.ng/Out/2025/CCD/CIRCULAR%20AND%20GUIDELINES%20FOR%20THE%20OPERATIONS%20OF%20AGENT%20BANKING%20IN%20NIGERIA%20OCTOBER%206%202025.pdf
- CBN, *Circular on Cash-out Limits for Agent Banking Transactions* (17 December 2024): https://www.cbn.gov.ng/Out/2024/CCD/Circular%20on%20Cash-out%20limits%20for%20Agent%20Banking%20Transactions.pdf

Nigeria is one potential adapter and test environment. It is not the product's scope or definition.

---

## 4. Product and system boundaries

### 4.1 Product name

**Keel Human Cash Access Network (HCA)**

Working sub-capabilities:
- **Keel Agent Assurance:** agent, principal, staff, location and terminal assurance.
- **Keel Local Liquidity Intelligence (KLLI):** multi-source cash/e-float capacity and replenishment coordination.
- **Agent Cash Assurance Envelope (ACAE):** sponsor-issued, bounded liability commitment for eligible degraded-connectivity payouts.
- **Emergency Cash Voucher (ECV):** transaction evidence bundle and claim reference.
- **Local Liquidity Exchange (LLX):** approved liquidity transfer and replenishment coordination between agents, super-agents and providers.
- **Offline Cash Settlement Protocol (OCSP):** optional terminal/card protocol for bounded offline value or claims.
- **Agent Claims and Disputes:** exception handling for disputed or interrupted cash delivery and settlement.

DH-ATM is a channel experience and operating pattern within HCA, not a claim that a merchant terminal is legally an ATM.

### 4.2 Existing Keel modules reused

HCA must integrate with, not duplicate:
- Human Authority Engine;
- Consumer Card Security and physical-card lifecycle;
- Payment Authority;
- double-entry ledger and atomic reservations;
- Financial State and verified availability;
- Authority Chain / evidence lineage;
- Financial Continuity and provider dependency model;
- AI Financial Guardian;
- reconciliation, dispute and recovery services.

HCA-specific logic must not create an alternate ledger or parallel source of truth.

### 4.3 External participants

- regulated principal / issuer / bank / e-money provider;
- licensed agent, merchant or ATM operator;
- master agent / super-agent / liquidity manager;
- sponsor / settlement guarantor / programme underwriter;
- custodian or escrow bank, where applicable;
- cash-in-transit and replenishment providers;
- terminal manufacturer and certification body;
- payment switch / PTSA / scheme / settlement system;
- customer and approved recovery/support channels;
- regulator and independent auditor, through authorised reporting interfaces.

---

## 5. Operating modes and state separation

### 5.1 Connected Cash Access

Flow:
1. customer selects an eligible agent/ATM/channel;
2. KLLI returns capacity with evidence freshness and confidence;
3. terminal and agent authenticate;
4. customer reviews amount, currency, fee, location and cash source;
5. Human Authority validates the request and mandate;
6. issuer/provider authorises the cash-out online;
7. agent dispenses cash under the provider's approved process;
8. provider confirms the financial transaction;
9. receipt and evidence are stored;
10. ledger and agent float are reconciled.

Online authorisation and provider finality remain authoritative. A Keel approval is not a substitute for issuer approval.

### 5.2 Degraded-connectivity Cash Access

This mode is allowed only when:
- the sponsor has issued a valid ACAE before the outage;
- the backing instrument and legal liability are verified to the required assurance level;
- the specific agent and terminal are eligible;
- agent cash inventory is sufficiently fresh and within local payout limits;
- the customer has a valid prefunded allocation or an explicit sponsor-underwritten claim path;
- customer authority is valid;
- transaction is within the envelope's remaining capacity;
- the applicable jurisdiction adapter permits the service;
- the terminal can create durable, signed evidence and enforce local limits.

The transaction creates an ECV. The ECV is a claim/evidence object; it is not automatically final settlement.

### 5.3 Device-Offline Cash Access

This mode requires a separately specified and certified protocol. Candidate design uses:
- prefunded customer-specific offline value or explicitly underwritten deferred claim;
- card secure element and certified terminal;
- issuer/sponsor-signed allocation;
- monotonic counters and anti-replay;
- bounded terminal and customer budgets;
- local transaction chain and signed acknowledgements;
- later reconciliation and conflict resolution;
- disclosed liability allocation for secure-element compromise and double spend.

A disconnected device cannot establish global uniqueness against every other disconnected terminal. Keel must not claim that offline signatures or a mesh network make double-spend impossible.

### 5.4 No silent downgrade

A failed online transaction cannot silently become degraded or device-offline. The customer must see the new mode, amount, fee, limits, settlement timing, liability and dispute treatment and give fresh approval where required.

---

## 6. Agent Cash Assurance Envelope (ACAE)

### 6.1 Definition

An ACAE is a sponsor-issued, time-bounded, agent- and programme-scoped commitment that defines the maximum qualifying emergency cash-out liability the sponsor agrees to honour, under specified conditions.

It is not a balance snapshot, an unverified promise, or a generic signed token. It must reference an enforceable funding or credit arrangement and the entity legally responsible for qualifying claims.

### 6.2 Required fields

- envelope ID and immutable version;
- sponsor legal identity and regulated status;
- principal/programme and jurisdiction references;
- eligible agent IDs, terminal IDs and locations or permitted scope;
- currency and exact integer-minor-unit capacity;
- maximum per transaction, per customer, per agent, per day and programme aggregate;
- effective time, expiry and revocation conditions;
- backing type and backing evidence reference;
- backing custodian/account or credit-facility reference, where applicable;
- legal agreement and claims terms reference;
- settlement account / redemption route reference;
- sponsor signing-key ID, certificate chain and signature;
- issue, refresh and revocation timestamps;
- permitted operating mode and outage trigger policy;
- dispute, fraud, loss-sharing and recovery rules;
- concentration and sponsor exposure limits.

### 6.3 Backing classifications

Do not collapse the following into one field:
1. **Prefunded segregated cash/cash-equivalent:** funds are placed under a disclosed legal arrangement and independently confirmed.
2. **Safeguarded programme funds:** legal segregation and beneficiary rights must be established by counsel and custodian evidence.
3. **Committed credit/liquidity facility:** a lender's enforceable commitment, with conditions, drawdown mechanics and counterparty risk.
4. **Sponsor guarantee:** contractual promise supported by the sponsor's creditworthiness, capital and enforceability; not the same as cash collateral.
5. **Unfunded promise / unsupported certificate:** not eligible as cash assurance.

The system records the exact instrument, not a marketing label. The sponsor can fail; escrow can be disputed; a facility can have conditions; insolvency law can alter recovery. Assurance is bounded, not absolute.

### 6.4 Capacity accounting

Maintain separate ledgers/counters for:
- committed sponsor liability;
- funded/secured backing amount;
- amount reserved for in-flight cash-outs;
- qualifying claims submitted;
- claims accepted;
- claims disputed;
- claims paid;
- remaining commitment;
- remaining verified backing;
- agent physical cash capacity;
- customer offline allocation;
- unresolved reconciliation exposure.

Available emergency payout capacity is the minimum of all applicable constraints, after currency, time, regulatory and policy checks. No field named simply `available_cash` may combine these without provenance.

### 6.5 ACAE lifecycle

`DRAFT → DUE_DILIGENCE → BACKING_VERIFICATION → LEGAL_APPROVAL → ISSUED → ACTIVE → PARTIALLY_UTILISED → EXHAUSTED | SUSPENDED | REVOKED | EXPIRED → RECONCILED → CLOSED`

An issued envelope is not active until the sponsor signature, backing verification, legal approval and local eligibility gates pass. Revocation blocks new reservations but does not erase already accepted claims. Existing claims remain payable/disputable under contract.

### 6.6 Reservation and consumption

ACAE capacity must be reserved atomically before a qualifying payout is accepted. The reservation binds:
- envelope version;
- agent and terminal;
- customer allocation/authority;
- transaction intent fingerprint;
- amount and currency;
- local transaction counter;
- expiry and mode;
- policy/rule version.

A duplicate request with the same idempotency key returns the original state. A changed amount, customer, terminal or currency is a new request and must not inherit the previous reservation.

---

## 7. Keel Local Liquidity Intelligence (KLLI)

### 7.1 Purpose

KLLI estimates and coordinates local cash-out capability without pretending that a reported number is independently verified. It is a liquidity intelligence service, not a custodian or owner of agent cash.

### 7.2 Separate inventory types

Per agent, location, terminal and currency, track:
- physical cash by denomination;
- electronic float by provider and account reference;
- agent-owned working capital;
- sponsor-backed ACAE capacity;
- customer-specific offline allocation;
- cash-in expected but not yet received;
- cash-out reserved and completed;
- pending claims and unreconciled transactions;
- replenishment requests and confirmed deliveries.

Never net physical cash and electronic float into one interchangeable amount. A customer asking for cash requires physical notes/coins in the required denomination and an eligible payout route.

### 7.3 Observation model

Every inventory observation must include:
- source actor and source system;
- observation type (self-reported, terminal-counted, independently counted, provider-confirmed, cash-in-transit confirmed);
- currency and denomination;
- amount in integer minor units;
- observed-at and received-at times;
- terminal/device identity;
- signature or source authentication;
- verification class;
- freshness threshold;
- correction and supersession lineage;
- confidence category and reason.

UI status vocabulary:
- **Confirmed recently** — corroborated by the configured independent/provider source within freshness limits.
- **Reported recently** — agent/terminal report, not independently corroborated.
- **Stale** — last observation exceeds the applicable threshold.
- **Unavailable** — source confirms no eligible capacity.
- **Unknown** — no reliable current evidence.

Do not show an agent as “available now” solely because it was available earlier.

### 7.4 Capacity calculation

For a cash-out request, eligible capacity is constrained by:
- denomination-compatible physical cash;
- fresh inventory observation;
- agent and terminal daily/transaction limits;
- provider and sponsor commitments;
- customer funds/allocation and authority;
- existing reservations and pending cash-out;
- agent operational status;
- security and location restrictions;
- jurisdiction rules;
- cash safety and replenishment thresholds.

The calculation must be deterministic, reproducible and versioned. AI may forecast demand and suggest replenishment, but it cannot turn an unverified observation into verified cash.

### 7.5 Forecasting and replenishment

Forecast:
- time-of-day/day-of-week demand;
- local events and seasonal patterns where lawful;
- denomination mix;
- cash-in/cash-out imbalance;
- provider/agent float needs;
- expected replenishment lead time;
- route and cash-in-transit constraints;
- security exposure and cash holding cost.

Recommendations must include uncertainty and source coverage. A forecast is not a cash commitment.

### 7.6 Local Liquidity Exchange (LLX)

Agent-to-agent or agent-to-super-agent replenishment is allowed only through an approved principal/programme arrangement. A transfer:
1. originates from a verified provider/agent relationship;
2. identifies source and receiving agent;
3. confirms both parties' permitted roles;
4. obtains required principal/sponsor approval;
5. reserves source cash/float and receiving capacity;
6. records a signed handover/delivery event;
7. updates each agent's inventory only at the correct evidence stage;
8. reconciles electronic float and physical cash separately.

A source agent cannot transfer sponsor liability to a receiving agent. The receiving agent must be accepted by the sponsor and the applicable envelope updated or reissued.

---

## 8. Emergency Cash Voucher (ECV)

### 8.1 Purpose and limits

ECV is a canonical, signed evidence bundle for an individual cash-out. It records the statements and acknowledgements of the customer, agent/terminal and sponsor programme. It supports later claims and reconciliation.

Cryptographic signatures prove that identified keys signed particular statements. They do not independently prove that physical cash was counted or handed over. Independent operational controls, receipt acknowledgement, disputes and audit remain necessary.

### 8.2 ECV contents

- globally unique voucher ID;
- canonical schema/version and transaction fingerprint;
- jurisdiction, currency and exact amount;
- customer pseudonymous subject and card/allocation reference;
- customer instruction and authority/mandate version;
- customer approval proof and trusted interaction context;
- agent, principal, staff and terminal identities;
- terminal certificate and counter;
- cash denomination declaration and inventory observation reference;
- ACAE ID/version and sponsor liability reference;
- capacity reservation ID;
- agent acceptance statement;
- disbursal statement;
- customer receipt acknowledgement, if received;
- timestamps with trusted clock source/quality;
- local connectivity/mode status;
- fee and disclosure reference;
- risk/policy decision and rule version;
- signatures and certificate/key IDs;
- status and exception references;
- later provider authorisation, claim, settlement and reconciliation references.

### 8.3 Handshake

1. Terminal authenticates itself and the agent programme.
2. Card/customer receives canonical amount, currency, fee, agent, location and mode.
3. Customer explicitly approves or rejects.
4. Keel/terminal verifies customer allocation and authority.
5. ACAE capacity is reserved where required.
6. Agent accepts the exact request.
7. Terminal records the cash-disbursal statement.
8. Customer acknowledges receipt, where possible.
9. Terminal seals ECV with signatures, counters and local transaction-chain link.
10. On reconnection, ECV is submitted idempotently for validation, claims and reconciliation.

### 8.4 Interrupted disbursal

If an agent reports cash handed over but the customer acknowledgement is missing:
- mark `DISBURSAL_REPORTED_RECEIPT_UNCONFIRMED`;
- do not mark completed or settled;
- preserve both signed statements and terminal evidence;
- block duplicate cash-out against the same intent until resolved;
- open a claims/dispute case;
- request approved corroboration (terminal audit, cash count, staff record, customer support, CCTV only where lawful and proportionate);
- apply the contract's loss allocation and sponsor claim rules;
- retain a reversible accounting state until claim decision.

If customer denies receipt, record a disputed claim. Do not erase either party's signed statement.

### 8.5 ECV lifecycle

`CREATED → CUSTOMER_APPROVED → CAPACITY_RESERVED → AGENT_ACCEPTED → DISBURSAL_REPORTED → RECEIPT_ACKNOWLEDGED → SEALED → SYNCED → VALIDATED → CLAIM_ACCEPTED | CLAIM_DISPUTED | REJECTED → SETTLED → RECONCILED`

Exception states include:
- `CUSTOMER_REJECTED`
- `CAPACITY_RESERVATION_FAILED`
- `DISBURSAL_REPORTED_RECEIPT_UNCONFIRMED`
- `CUSTOMER_DISPUTE_OPEN`
- `DUPLICATE_DETECTED`
- `OFFLINE_CONFLICT`
- `SPONSOR_DEFAULT_EXPOSURE`
- `RECONCILIATION_REQUIRED`

No exception state may be coerced into `SETTLED` by a retry.

---

## 9. Accounting and financial state integration

HCA must use the global Keel ledger and posting coordinator. No parallel HCA balance store may authorise money movement.

### 9.1 Required accounting dimensions

At minimum distinguish:
- customer available funds and customer offline allocation;
- provider/issuer settlement receivable/payable;
- agent cash-out payable/receivable under the principal's legal model;
- sponsor commitment and contingent liability register;
- funded reserve/escrow asset and corresponding legal beneficiary/liability classification;
- agent physical cash observation (memorandum/inventory, not automatically a Keel asset);
- cash-out reservation;
- ECV claim pending;
- accepted sponsor claim;
- disputed claim;
- settlement paid;
- fees and agent remuneration;
- loss, recovery and chargeback.

The exact journal entries depend on whether the principal, sponsor, custodian or agent is legally principal to the transaction. Keel must not prescribe a single universal chart-of-accounts treatment where legal ownership and agency differ.

### 9.2 Non-negotiable accounting controls

- exact integer minor units and explicit currency exponent;
- balanced debits/credits per currency;
- immutable posted journal entries;
- compensating reversals only;
- atomic reservations and capacity consumption;
- idempotency at request, voucher, claim and settlement layers;
- tenant isolation and row-level access controls;
- outbox/inbox events committed with state transitions;
- no provider network calls inside a database transaction;
- reconciliation against independent provider/issuer/sponsor statements;
- no cross-currency netting without an approved FX transaction and valuation source.

### 9.3 Capacity is not settlement

ACAE capacity is a contractual/liquidity limit, not a settled customer balance. ECV is evidence/claim, not settled cash. The ledger must keep commitment, reservation, disbursal report, accepted claim and paid settlement as separate states.

---

## 10. APIs and integration contracts

API names are proposed resource contracts; final naming follows repository conventions.

### 10.1 Agent assurance
- `POST /api/hca/agents`
- `GET /api/hca/agents/{agentId}`
- `POST /api/hca/agents/{agentId}/assurance-events`
- `POST /api/hca/terminals/{terminalId}/attestations`
- `POST /api/hca/agents/{agentId}/suspend`
- `GET /api/hca/agents/{agentId}/eligibility`

### 10.2 Liquidity
- `POST /api/hca/liquidity/observations`
- `GET /api/hca/liquidity/nearby`
- `POST /api/hca/liquidity/reservations`
- `POST /api/hca/replenishments`
- `POST /api/hca/replenishments/{id}/confirm-delivery`
- `GET /api/hca/liquidity/forecast`

### 10.3 ACAE
- `POST /api/hca/envelopes`
- `POST /api/hca/envelopes/{id}/backing-evidence`
- `POST /api/hca/envelopes/{id}/activate`
- `POST /api/hca/envelopes/{id}/suspend`
- `POST /api/hca/envelopes/{id}/revoke`
- `GET /api/hca/envelopes/{id}/capacity`

### 10.4 Cash-out and ECV
- `POST /api/hca/cash-outs/intent`
- `POST /api/hca/cash-outs/{id}/approve`
- `POST /api/hca/cash-outs/{id}/agent-acceptance`
- `POST /api/hca/cash-outs/{id}/disbursal`
- `POST /api/hca/cash-outs/{id}/receipt`
- `GET /api/hca/vouchers/{voucherId}`
- `POST /api/hca/vouchers/{voucherId}/sync`
- `POST /api/hca/vouchers/{voucherId}/claims`
- `POST /api/hca/claims/{claimId}/decision`
- `POST /api/hca/claims/{claimId}/settlement`

### 10.5 Integration rules

- OAuth2/OIDC or mutually authenticated service identity for online APIs.
- Signed webhook events with raw-body signature verification, timestamp freshness, key rotation, unique event IDs and replay prevention.
- Canonical JSON/CBOR schema with explicit versioning and domain-separated signatures.
- Idempotency keys for all financial requests.
- Tenant, principal, agent, terminal, customer and jurisdiction scope checked server-side.
- No client-supplied balance, backing, licence, agent status or cash inventory is authoritative.
- Provider adapters return explicit `APPROVED`, `DECLINED`, `PENDING`, `UNKNOWN`, `SETTLED` and `REVERSED` states as supported; timeout is not decline or success.
- API responses disclose the evidence class and as-of time.

---

## 11. Global policy and jurisdiction adapter model

A jurisdiction profile is versioned, signed/approved by the responsible compliance owner and effective-dated.

It must contain:
- jurisdiction and regulator references;
- permitted HCA modes;
- eligible regulated entity and agent roles;
- required licences, registrations and appointment evidence;
- KYC/CDD and AML/CFT rules;
- sanctions and monitoring requirements;
- customer and agent transaction limits;
- fee rules and disclosures;
- permitted currencies and cash denominations;
- terminal, switch and reporting requirements;
- safeguarding/custody/guarantee legal classifications;
- privacy, data residency, retention and transfer rules;
- dispute and consumer redress process;
- required audit evidence and reporting formats;
- legal owner, approval record, source citations and next review date.

A local adapter may be stricter than the global baseline. It may not disable customer approval, double-entry accounting, evidence provenance, idempotency, tenant isolation or truthful state display.

No Nigeria or UK limit is a global default. Limits are data, versioned and approved per jurisdiction and programme.

---

## 12. Communications and network resilience

### 12.1 NFC and BLE

NFC is suitable for card-to-terminal proximity exchange. BLE can support richer terminal/device communication where hardware, power and threat models permit. The protocol must authenticate both endpoints and bind every message to a nonce, session, amount, currency, terminal and voucher ID.

### 12.2 LoRaWAN / low-bandwidth mesh

LoRaWAN or another low-bandwidth network may distribute signed operational status and replenishment alerts:
- agent service suspended;
- terminal revoked;
- cash level below configured threshold;
- replenishment dispatched/received;
- ACAE suspended or exhausted;
- local connectivity degraded.

It is not the payment authorisation channel, not a source of customer balances and not proof of physical cash. Do not broadcast customer identity, balance, transaction details or sensitive inventory. Messages require authentication, freshness, replay protection and privacy review.

### 12.3 User-facing availability

Only publish:
- **Confirmed recently**;
- **Reported recently**;
- **Stale**;
- **Unavailable**;
- **Unknown**.

A nearby location must not be advertised as available until the applicable capacity is reserved or the UI clearly states that final confirmation occurs at the terminal. Do not promise service during a blackout when sponsor, cash, terminal, card and liability conditions are not met.

---

## 13. Agent assurance, remuneration and customer protection

### 13.1 Agent assurance

Agent eligibility evaluates:
- licensed principal/programme relationship;
- legal business identity and approved premises;
- permitted services and effective appointment;
- staff identity, role and training;
- terminal hardware identity and certificate status;
- security, cash-handling and reconciliation procedures;
- cash/e-float observation quality;
- outstanding claims and settlement performance;
- complaints, fraud and operational incidents;
- inspection, training and certification status;
- emergency-programme eligibility and liability coverage.

AI may flag anomalous patterns for human review. A score alone must not make an unreviewable accusation or silently exclude a customer or agent.

### 13.2 Customer limits

Reject neighbourhood co-signing or proximity trust scores as a way to increase customer withdrawal limits. Nearby cardholders cannot prove another person's identity, funds or repayment capacity. This creates collusion, coercion, privacy, discrimination and exclusion risks.

Customer eligibility and limits must come from the issuer/principal's approved KYC, risk, funds and regulatory policy. Any exception must be explicitly authorised by the regulated principal and disclosed.

### 13.3 Agent economics

Do not assume a universal 2% emergency fee. Fees may be capped or prohibited, and high flat fees can harm customers and distort agent behaviour.

Potential transparent compensation components, only where permitted:
- ordinary transaction commission;
- readiness/availability retainer funded by the programme sponsor;
- disclosed service fee within approved limits;
- liquidity management and replenishment fee;
- reliability reward based on service, reconciliation and consumer-protection metrics.

Readiness compensation should reward verified capacity and service quality, not merely transaction volume. No hidden fee, forced tip or undisclosed FX margin.

---

## 14. Threat model and loss allocation

Threat actors and failure modes:
- dishonest agent or staff collusion;
- counterfeit or cloned terminal;
- compromised card/secure element;
- stolen customer card or coerced approval;
- sponsor insolvency or refusal to honour claims;
- fake or stale cash inventory;
- double spending across disconnected terminals;
- duplicate/replayed voucher;
- false customer receipt or false agent disbursal statement;
- cash theft during replenishment;
- compromised signing keys or webhook secrets;
- local network partition or clock manipulation;
- malicious software update or supply-chain compromise;
- AML/CFT abuse, mule networks and agent collusion;
- provider, custodian, switch or cash-in-transit failure.

Each programme contract must allocate:
- customer loss and unauthorised transaction liability;
- agent cash loss and theft;
- terminal compromise;
- sponsor default and guarantee shortfall;
- disputed or unconfirmed cash delivery;
- double-spend and offline fraud;
- late or missing reconciliation;
- operational outage and customer redress.

Keel records and enforces the agreed allocation where technically possible; it does not make an insolvent sponsor solvent or create legal priority by writing a voucher.

---

## 15. Acceptance tests

### Agent and terminal
- unappointed agent → reject;
- agent appointment expired or suspended → reject;
- revoked terminal certificate → reject;
- staff role lacks cash-out permission → reject;
- terminal counter rollback or cloned identity → reject and raise security event;
- agent's cash is self-reported and stale → status cannot be “confirmed recently”.

### Liquidity
- agent has physical cash but no electronic float for an online route → online route ineligible;
- agent has electronic float but no physical cash → cash-out unavailable;
- sponsor envelope exists but agent has no eligible physical cash → reject;
- agent cash exists but sponsor envelope is absent/exhausted → degraded cash-out reject;
- denomination mismatch → reject or offer a newly approved amount;
- stale LoRa/mesh status → UNKNOWN, not available;
- replenishment dispatched but not delivered → do not increment received inventory;
- cash transferred between agents without receiving-agent acceptance → no capacity transfer.

### ACAE
- no enforceable backing evidence → cannot activate;
- guarantee represented as cash reserve → schema/policy validation rejects misclassification;
- expired/revoked envelope → no new reservation;
- concurrent requests exceed envelope capacity → at most one valid reservation succeeds;
- sponsor commitment exhausted → reject;
- sponsor default event → expose outstanding claims and freeze new exposure under policy;
- revocation after accepted claim → preserve existing claim and apply contract terms.

### Customer authority and voucher
- customer rejects → no payout;
- customer allocation exhausted → reject;
- stale customer balance snapshot → no approval;
- agent signs without customer approval → no valid cash-out;
- duplicate voucher → one logical claim/settlement;
- cash disbursal reported but receipt missing → exception, not completed;
- customer disputes receipt → preserve evidence and open claims case;
- amount/currency/fee/agent changes after approval → invalidate approval and require fresh approval;
- ECV with missing sponsor reference in degraded mode → reject;
- voucher sync timeout → UNKNOWN and safe idempotent retry.

### Accounting and reconciliation
- posted journal mutation → database rejects;
- unbalanced journal → reject;
- duplicate settlement submission → one logical posting;
- customer, agent and sponsor capacity updates must be atomic with reservation/posting;
- agent physical cash must never be booked as Keel-owned cash without legal ownership and custody evidence;
- unresolved claim must not be displayed as settled;
- cross-currency conversion without authorised FX evidence → reject.

### Global policy
- missing jurisdiction adapter → HCA mode unavailable;
- expired local rule profile → HOLD;
- local limit stricter than global policy → stricter limit applies;
- local adapter attempts to weaken human authority or ledger invariants → reject deployment/configuration;
- local policy update must preserve historical rule version for each transaction.

---

## 16. Implementation sequence

### Stage 0 — Architecture and policy baseline
- Approve HCA domain model and global invariants.
- Define jurisdiction adapter contract and governance.
- Map HCA to existing Keel card, authority, ledger and continuity code.
- Create threat model, loss-allocation matrix and source-of-truth matrix.
- No code for offline cash-out yet.

### Stage 1 — Financial truth foundation
- Complete transactional ledger persistence and posting coordinator.
- Atomic reservations and exact availability.
- Idempotency, outbox/inbox and immutable posted entries.
- PostgreSQL integration and concurrency tests.
- Reconciliation framework and verified source ingestion.

### Stage 2 — Agent Assurance
- Agent/principal/staff/terminal registry.
- Signed appointment and attestation evidence.
- Suspension/revocation, permitted service and inspection history.
- Role and tenant isolation.

### Stage 3 — KLLI
- Cash/e-float inventory observations and freshness.
- Capacity engine with denomination, limits and reservations.
- Liquidity forecast and replenishment workflow.
- Local status API and operator dashboard.

### Stage 4 — ACAE
- Sponsor, legal instrument and backing registry.
- Capacity/commitment ledger and reservation coordinator.
- Claim eligibility, revocation and sponsor exposure.
- Independent legal and financial control review.

### Stage 5 — Connected cash access
- Integrate one licensed provider sandbox and certified/approved agent terminal.
- Complete online authorisation, receipt and reconciliation.
- Test service quality, agent economics and consumer disputes.
- No offline claims in this stage.

### Stage 6 — Degraded-connectivity ECV
- Build ECV schema, signing and claim lifecycle.
- Simulate connectivity interruption and sponsor-backed claims.
- Test cash delivery exceptions and duplicate/replay cases.
- Controlled, prefunded sandbox only.

### Stage 7 — Device-offline research
- Select secure element and terminal hardware.
- Formal protocol review and adversarial testing.
- Model partition risk, double-spend loss and sponsor liability.
- Small-value prefunded prototype only after legal/partner approval.
- No production ATM or cash-out claims without certification and contract.

### Stage 8 — Multi-jurisdiction pilots
- Validate independent jurisdiction adapters with local counsel and regulated partners.
- Potential test environments may include the UK, Nigeria and other willing markets, selected by partner readiness and legal feasibility.
- Each market must pass its own compliance, scheme, security, liquidity and customer-protection gates.
- Compare results without changing global core invariants.

---

## 17. Forbidden shortcuts

- Do not describe HCA as an unlicensed global ATM network.
- Do not imply the World Bank, Bank of England, CBN, LINK or any regulator endorses Keel.
- Do not equate a signed voucher with physical cash delivery.
- Do not equate a sponsor guarantee with funded cash.
- Do not use a historic balance snapshot to authorise withdrawal.
- Do not treat an agent's cash as Keel's asset or as customer deposits.
- Do not silently downgrade an online transaction to offline.
- Do not promise global double-spend prevention during network partition.
- Do not make LoRaWAN the payment authorisation rail.
- Do not let AI or neighbourhood co-signers increase customer limits.
- Do not impose a universal emergency fee or copy one country's limits globally.
- Do not activate cash-out without licensed principal, legal liability, funding, terminal and dispute arrangements.
- Do not deploy a migration, live API or production flow before PostgreSQL, concurrency, security, privacy and operational tests pass.
- Do not call a prototype, signed callback or passing unit test a production financial service.

## 18. Differentiation and invention discipline

Agent banking, super-agents, ATM networks, cash-at-till, offline payments, secure elements, digital signatures, escrow, guarantees, liquidity forecasting, mesh communication and AI risk detection are established categories.

Keel's potential differentiated contribution is the **integrated global assurance protocol** linking:
- human-authorised cash access;
- independently qualified agent and terminal;
- denomination-aware physical liquidity;
- sponsor-issued, legally classified cash-out capacity;
- transaction-level dual acknowledgement and signed evidence;
- explicit exception and claim lifecycle;
- atomic ledger reservation and settlement;
- local liquidity replenishment coordination;
- jurisdiction adapters with invariant global controls.

This remains an architecture and product hypothesis, not a verified patent claim. A dedicated prior-art search and specialist patent/legal review are required before describing it as novel, first-of-kind or exclusive.

## 19. Architecture acceptance

HCA is accepted as a proposed Keel Financial Continuity subsystem when:
1. global invariants and local adapter boundaries are approved;
2. the existing ledger and reservation foundation can support the required atomicity;
3. agent, sponsor, cash inventory, ECV and claim states are separately modelled;
4. legal backing and physical cash are never conflated;
5. every cash-out mode has explicit authority, liability and dispute rules;
6. all acceptance tests are represented as executable tests before any live pilot;
7. no production or public availability claim is made until the required partners and assurance gates exist.

**Next engineering dependency:** complete the transactional ledger/posting and reservation foundation first. In parallel, HCA may be developed as a documented domain model and non-executing simulator, but it must not create a second financial ledger or bypass the existing release gates.
