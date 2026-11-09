# Keel Financial Infrastructure Completion Standard

Status: target architecture and acceptance baseline; not a statement that all capabilities are implemented or production-ready.

## Mission

Keel is an evidence-bound institutional financial state, control and resilience layer interoperating with banks, custodians, lenders, treasuries, payment systems, market infrastructure, government finance and AI agents. It does not replace regulated institutions or assume custody, legal title, lending authority or payment execution.

## Financial domain coverage

1. Identity, legal entities, accounts, mandates, beneficial ownership references and authority.
2. Cash, deposits, bank balances, receivables, payables, securities, commodities, digital-asset references and service entitlements.
3. Commitments, liens, pledges, restrictions, collateral eligibility, concentration, rehypothecation and encumbrance.
4. Liquidity, cash forecasting, intraday liquidity, funding gaps, maturity ladders and contingency funding.
5. Credit, facilities, limits, covenant monitoring, exposure, expected cash flows, collateral haircuts and concentration.
6. Treasury, FX exposure, currency mismatch, interest-rate risk, counterparty and market risk.
7. Payments, clearing, settlement, reconciliation, returns, reversals, disputes and failed/late settlement.
8. Accounting and reporting: chart-of-account mapping, double-entry journals, subledgers, close controls, valuation and audit trails.
9. Securities and custody lifecycle: instrument identity, holdings, corporate actions, settlement status, custody statements and asset servicing.
10. Trade finance and receivables: invoices, purchase orders, letters of credit/guarantees as evidence references, assignment, dilution and disputes.
11. Programmable money and tokenised instruments: classification, issuer/redemption, reserve evidence, transfer restrictions, bridge/custodian risk and depeg exposure. No token is presumed cash or legal collateral.
12. Public finance: budget authority, appropriations, commitments, disbursements, grants, procurement, debt service, public asset registers and audit trails.
13. Insurance and risk transfer: policy/coverage references, exclusions, limits, claims, counterparty credit and recoverability.
14. Productive-capacity finance: contracted demand, provider capacity, delivery, acceptance, receivable assignment, actual cash collection and repayment.
15. AI-agent finance: principal identity, delegated mandate, permitted instruments, limits, purpose, expiry, approval, execution boundary and post-action reconciliation.
16. Operational resilience: bank/provider/custodian/market/telecom/cloud outages, cyber events, jurisdiction restrictions, recovery priorities and evidence preservation.
17. Regulatory assurance: obligation applicability, controls, evidence, findings, remediation and review status.

## Core invariants

- Reported balance is not the same as available balance.
- Available value = verified position less restrictions, commitments, prior claims, policy reserves and applicable haircuts; calculations must avoid double counting.
- Asset existence, ownership, legal title, priority, enforceability and freedom from encumbrance are separate assertions with separate evidence requirements.
- A hash is not a signature, source authentication, legal attestation or independent notarisation.
- No evidence freshness means no positive availability decision unless a documented policy explicitly allows it.
- Money uses integer minor units or exact decimal arithmetic; no binary floating-point financial calculations.
- Double-entry ledger postings balance by currency and legal entity; no cross-currency netting without explicit FX legs and valuation.
- State changes are atomic, idempotent, tenant-scoped and auditable.
- Payment instruction, payment acceptance, clearing, settlement and finality are distinct states.
- Collateral pools, provider performance bonds, client funds and service-credit liabilities remain separately identified.
- Forecasts and contracted future revenues are not cash or guaranteed repayment.
- AI agents cannot exceed principal mandates; fail closed on unknown identity, stale policy, limit breach or unavailable approval service.
- No automatic collateral liquidation, token issuance, FX trade, lending, payment or asset transfer without explicit legal authority and dual-control workflow.

## Cross-cutting engines required

- Financial State Core and double-entry subledger.
- Collateral and encumbrance registry with cross-facility duplicate-use prevention.
- Liquidity and funding engine with intraday and stress horizons.
- Credit and exposure engine with counterparty, concentration, covenant and maturity dimensions.
- Market, FX and valuation engine with source quality and stale-price controls.
- Payment/clearing/settlement state machine with reconciliation.
- Treasury and ALM engine for cash, liquidity, rates, currencies and maturity gaps.
- Securities/custody and asset-servicing adapter model.
- Trade finance and receivables evidence engine.
- Public finance control model.
- Insurance/guarantee evidence and recoverability model.
- Programmable currency and service-entitlement classification.
- Temporal Value & Capacity Engine and Temporal Clearinghouse.
- Fracture, continuity and recovery engine.
- Agent authority and bounded action gate.
- Regulatory Assurance Fabric.

## Required institutional integration contract

Each connector must declare institution/provider, environment, supported products, API/schema version, authentication method, consent/mandate scope, data provenance, timestamps/time zone, pagination, rate limits, idempotency, webhook signature, retry/backoff, replay protection, reconciliation method, error taxonomy, service-level expectations, data residency, retention and incident contact. Every connector needs contract tests, sandbox fixtures, failure simulation and version compatibility tests. A successful API response alone does not prove a financial record is correct.

## Release gates

A financial capability cannot be called production-ready until:
- exact calculation rules and accounting treatment are documented and reviewed;
- authoritative data sources and provenance are verified;
- persistence, tenant isolation, transactional consistency and idempotency are tested;
- concurrency, duplicate, replay, stale-data and adversarial tests pass;
- reconciliation and exception handling work end to end;
- access control, key management, logging and privacy controls pass independent review;
- operational monitoring, incident response, backups and recovery are demonstrated;
- external integration contracts and certification evidence exist where required;
- legal/regulatory scope and institution-specific operating responsibilities are reviewed.

## Explicit non-goals without separate authorisation and regulatory review

Keel is not itself a bank, custodian, payment system, exchange, central counterparty, credit bureau, insurer, asset manager or government authority. It does not hold client funds or private keys, guarantee collateral recovery, issue general-purpose money, provide legal title opinions, or make autonomous lending/settlement decisions.
