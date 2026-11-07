# Keel Financial Fracture Engine (KFFE)

## Purpose
KFFE is an advisory, deterministic scenario-assessment layer for institution-supplied financial exposures. It evaluates pre-fracture vulnerabilities, during-fracture stress and post-fracture recovery evidence. It is not a collapse predictor, autonomous portfolio manager, payment switch, lender, resolution authority or supervisory stress-test replacement.

## Research basis
- FSB (14 Nov 2024), The Financial Stability Implications of Artificial Intelligence: identifies third-party dependencies and concentration, market correlations, cyber risk, model risk, data quality and governance, and AI-enabled fraud/disinformation as vulnerabilities that can amplify systemic risk.
- FSB (10 Oct 2025), Monitoring Adoption of Artificial Intelligence and Related Vulnerabilities in the Financial Sector: discusses monitoring approaches and indicators, including third-party dependencies and provider concentration.
- IMF, Global Financial Stability Report, October 2024, Chapter 3: discusses AI-related capital-market opportunities and risks including concentration, correlated strategies, volatility, cyber and manipulation.
- Bank of England, Financial Stability Report, July 2026: highlights challenges in monitoring more autonomous AI and the need for system-level visibility, indicators and intervention mechanisms.
- Federal Reserve History documents the Great Depression as a sequence of market, regional banking and international banking crises, followed by emergency measures and institutional reforms. The Banking Act of 1933 created the FDIC and contained Glass-Steagall provisions; the FDIC became permanent under the Banking Act of 1935. Dodd-Frank followed the 2007–09 crisis in 2010.

## Three operating stages
1. BEFORE — Exposure Readiness: baseline liquidity/funding, collateral eligibility and encumbrance, counterparty graph, critical providers, payment rails, currency and sovereign dependencies, model/data lineage, evidence freshness and contingency readiness.
2. DURING — Containment Intelligence: apply explicit tenant-selected shocks; quantify conditional liquidity gaps and collateral shortfalls; map exposures; identify missing/contradictory evidence; preserve snapshots; escalate to authorised teams. No automated asset switching, trading, transfer, payment cancellation or execution.
3. AFTER — Recovery Integrity: reconcile cash, collateral, claims, counterparties, payment queues, funding access and provider restoration; preserve losses and disputed positions; record approvals and evidence of recovery. No automatic reopening or release.

## v1 implementation
src/fracture-engine.js provides deterministic scenario calculations for institution liquidity, funding due, expected inflows, eligible collateral, haircuts, bilateral exposures, payment-rail outage, provider outage, cyber incident, currency stress and market dislocation. It returns a three-stage assessment, institution-level conditional shortfalls, systemic flags, illustrative exposure links, action suggestions, recovery checks and SHA-256 fingerprints.

## Critical boundaries
- Inputs are supplied by the tenant. No live market, bank, payment, custodian, registry, central bank or sovereign data is queried.
- Output is conditional scenario arithmetic, not a prediction, probability, default finding, solvency opinion or legal determination.
- Exposure links do not prove a counterparty will fail.
- No transaction execution or asset movement.
- Later AI may help draft scenarios or explain anomalies, but calculation and policy gates remain deterministic, reviewable and versioned.
- Institution-approved crisis playbooks and authorised humans remain responsible.

## Next phases
- PostgreSQL scenario runs, snapshots, dependencies, recovery checkpoints and event links.
- Tenant-scoped APIs and UI with synthetic demo data.
- Historical replay and scenario calibration with licensed/official data; label actuals, estimates and simulations distinctly.
- Network contagion modelling with explicit solvency/liquidity assumptions, settlement timing and feedback loops; validate against published stress-test methods.
- Independent validation, security review, model risk governance and jurisdiction-specific legal review before institutional use.

## Research references
- https://www.fsb.org/2024/11/the-financial-stability-implications-of-artificial-intelligence/
- https://www.fsb.org/2025/10/monitoring-adoption-of-artificial-intelligence-and-related-vulnerabilities-in-the-financial-sector/
- https://www.imf.org/en/Publications/GFSR/Issues/2024/10/22/global-financial-stability-report-october-2024
- https://www.bankofengland.co.uk/financial-stability-report/2026/july-2026/
- https://www.federalreservehistory.org/essays/great-depression
- https://www.federalreservehistory.org/essays/glass-steagall-act
- https://www.federalreservehistory.org/essays/dodd-frank-act
- https://www.fdic.gov/90years
