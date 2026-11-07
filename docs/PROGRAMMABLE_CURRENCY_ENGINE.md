 # Keel Programmable Currency & Agent Settlement Engine

## Positioning
Keel should prepare for machine-to-machine commerce without assuming AI agents will converge on one new currency. Build an issuer-neutral monetary and service-value interoperability layer. Record unit, issuer, legal claim, redemption, precision, settlement finality, restrictions and evidence. Keel does not issue money, create deposits, custody assets, operate an AMM or move funds.

## Research finding
The claim that compute or energy will become universal AI money is a hypothesis, not an established forecast. Compute-seconds and kWh are service-denominated units whose value depends on provider, hardware, quality, geography, time, availability, metering and contract delivery. They are not automatically fungible stores of value.

The more evidence-backed direction is programmable settlement across multiple forms of money and assets:
- BIS/CPMI (21 Oct 2024), Tokenisation in the context of money and other assets: tokenisation can enable programmable platforms but safety requires sound governance and risk management.
- BIS Annual Economic Report 2025, chapter III: discusses a unified ledger joining tokenised central bank reserves, commercial bank money and assets; emphasises singleness, elasticity and integrity.
- BIS Annual Economic Report 2026: describes tokenised central bank reserves, tokenised commercial bank money and regulated private money, subject to redeemability, governance, transparency and financial integrity safeguards.
- FSB 2023 stablecoin recommendations: governance, risk management, data access, recovery/resolution, disclosures, redemption rights and compliance before operation.

## Engine layers
1. Instrument Registry: sovereign fiat references, tokenised deposits, stablecoins, CBDC/central-bank money interfaces, tokenised assets and service credits (compute, energy, bandwidth). Record issuer, legal claim, redemption, backing evidence, jurisdiction, unit, precision and restrictions.
2. Agent Authority: bind agent identity to tenant, accountable human principal, purpose, spending limits, approved counterparties, expiry and revocation. A key is not proof of legal identity or AML/KYC completion.
3. Programmable Mandate: bounded policy conditions, not arbitrary executable code. Support delivery evidence, approval thresholds, expiry, cancellation and dispute states.
4. Settlement Adapter: future interfaces to bank APIs, regulated tokenised deposit platforms, CBDC pilots, payment networks and licensed digital-asset providers. Expose finality, reversibility, fees, limits, jurisdiction and outage behaviour.
5. Conversion & Pricing: quotes only from named, timestamped and licensed sources; expose spread, fees, liquidity, slippage, expiry and executable status. No predictive AMM in core.
6. Reconciliation & Proof: double-entry ledger, idempotency, immutable event references, settlement status, source evidence and Authority Chain linkage.
7. Fracture Controls: depeg, issuer redemption suspension, reserve opacity, bridge/chain outage, liquidity deterioration, oracle divergence, cyber incident and jurisdiction restrictions feed the Financial Fracture Engine.

## Current implementation boundary
src/currency-engine.js defines an instrument catalogue, exact decimal-to-integer-unit conversion, account definitions, conditional transfer preparation and balance arithmetic. Fiat and stablecoin references are non-transferable. Compute and energy credits are service credits, not money. Transfer preparation is simulation only. No wallet, private-key custody, blockchain, bank rail, FX quote, mint/burn, redemption or settlement is connected.

## Security principles
- No agent can create money or expand its own authority.
- No arbitrary key custody by Keel in v1.
- No transfer without tenant-scoped principal authority, policy and idempotency.
- Double-entry postings atomic and balanced; balances derived from entries.
- Separate authorization from settlement confirmation.
- Explicit pending, settled, failed, reversed and disputed states.
- Independent issuer and reserve evidence; never infer 1:1 backing from token label.
- Fail closed on stale quotes, uncertain finality, revoked identity, policy breach or fracture alert.
- Human approval for high-value, novel, cross-border or irreversible actions.
- No automatic switching into crypto, gold, commodities or other assets during crisis.

## Roadmap
A. Simulation-only internal ledger and tests.
B. Tenant-scoped accounts, mandates, double-entry journals, idempotency and event-chain proofs.
C. Sandboxed agent-to-agent service-credit marketplace with metered delivery and dispute controls.
D. Licensed settlement adapters and official issuer interfaces after legal, technical and partner approval.
E. Independent security, operational resilience, AML/CFT, consumer protection, custody, safeguarding, redemption and jurisdictional review before live money activity.

## Sources
- https://www.bis.org/cpmi/publ/d225.htm
- https://www.bis.org/publ/arpdf/ar2025e3.pdf
- https://www.bis.org/publ/arpdf/ar2026e.pdf
- https://www.fsb.org/2023/07/high-level-recommendations-for-the-regulation-supervision-and-oversight-of-global-stablecoin-arrangements-final-report/
