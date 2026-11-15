# Plumbline Keel — AI Infrastructure Finance & Assurance
## Ecosystem partnership concept note

**Status:** Independent product concept and design-partner proposal. Plumbline Keel is not an NVIDIA partner, NVIDIA-certified provider, NVIDIA supplier, lender, credit rating agency or representative of any named institution.

## The problem

AI infrastructure financing connects equipment suppliers, GPU cloud operators, data-centre developers, compute customers, lenders, private-credit funds, insurers and public finance institutions. These parties often evaluate different fragments of the same economic system.

A project can have equipment invoices without deployed capacity; deployed GPUs without usable power; capacity reservations without collected cash; contracted revenue subject to cancellation; assets already pledged; or guarantees and investments that create correlated exposures across multiple counterparties.

Keel proposes a vendor-neutral evidence and monitoring layer that connects these records and makes scope, provenance, freshness, conflicts and assumptions inspectable.

## What Keel offers

1. **Asset and collateral evidence:** declared asset identity, ownership evidence, encumbrances, haircuts and competing claims.
2. **Contract and obligation lineage:** equipment purchases, leases, capacity reservations, offtake contracts, guarantees, payment terms, cancellation rights and debt schedules.
3. **Productive-capacity monitoring:** deployed capacity, available capacity, utilisation, telemetry provenance, downtime and customer acceptance.
4. **Revenue-quality reconciliation:** contracted revenue separated from invoices, billable usage, collections, operating costs and cash available for debt service.
5. **Financing exposure mapping:** investments, credit support, guarantees, customer and supplier concentration, maturity and refinancing dependencies.
6. **Continuous evidence:** time-stamped assessments, policy versions, exception history, human approvals and evidence changes.

## Why it is useful to the ecosystem

- Technology suppliers: better visibility into customer, partner, payment-term, guarantee and capacity-commitment exposures.
- AI cloud and data-centre operators: a structured evidence package for asset-backed or contracted-cash-flow financing.
- Banks and private credit: independent evidence lineage, collateral and contract checks, cash-flow reconciliation and covenant monitoring.
- Insurers: evidence of asset identity, deployment, maintenance and operating conditions.
- Government finance: traceability from capital allocation to equipment deployment, operational capacity and agreed outcomes.

Keel complements—not replaces—lenders, legal counsel, auditors, registries, asset appraisers, insurance underwriters, system-of-record platforms and technology-provider partner programmes.

## Proposed design-partner pilot

**Use case:** one GPU infrastructure project or AI cloud financing portfolio.

**Scope:** a limited asset pool, one or two customer/offtake contracts, one financing structure and a defined reporting period.

**Data sources:** asset register and ownership evidence; liens/encumbrance searches; supplier invoices and serial references; deployment and capacity telemetry; executed customer contracts; billing and collections; operating costs; debt schedules; covenant definitions.

**Outputs:** asset and obligation map; evidence completeness report; contracted-versus-collected cash bridge; utilisation and revenue-realisation metrics; collateral eligibility diagnostics; debt-service coverage calculations; exception register; versioned evidence package.

**Pilot success criteria (to agree with partner):**
- Reconcile a selected asset population to authoritative source records.
- Identify missing, stale, conflicting and duplicate/overlapping claims.
- Reproduce a defined cash-flow and covenant calculation.
- Trace a selected sample from asset purchase through deployment, customer usage, billing and collection.
- Demonstrate tenant separation, access controls, auditability and evidence lineage.
- Agree false-positive, false-negative and exception-resolution thresholds before any production use.

No success thresholds or data access are presumed. The partner and its independent reviewers set the test population and acceptance criteria.

## Integration model

Keel should initially accept controlled, read-only data feeds or customer-generated evidence packages. Adapters can be designed for ERP, asset-management, telemetry, billing, contract-management, treasury, loan-servicing and custody systems. Each connector needs an explicit permission manifest, tenant boundary, source identity, timestamp, reconciliation rule and revocation mechanism.

No NVIDIA API, internal data feed, account, telemetry, financing system or private partner interface is assumed to be available. Any future integration would use public documented interfaces or an explicitly authorised partner-provided interface, subject to review and approval.

## Commercial model to test

- Paid, fixed-scope design-partner pilot.
- Annual enterprise platform subscription based on project/portfolio scope and evidence volume.
- Connector and implementation fees.
- Optional ongoing portfolio monitoring and assurance reporting.
- Partner delivery and integration arrangements where the partner owns implementation.

Do not price based on credit approval, financing volume, asset valuation or a promise of capital access. Do not imply underwriting or certification.

## Suggested outreach route

1. Start with AI cloud and data-centre operators and infrastructure finance providers where the pain is immediate and data access can be authorised.
2. Run one measurable project-level pilot and produce an anonymised evidence demonstration.
3. Approach ecosystem teams at technology suppliers with the evidence of a working partner use case.
4. For NVIDIA, identify the relevant public partner-program route and propose a bounded ecosystem pilot. Ask for routing to the appropriate AI infrastructure, cloud partner, enterprise finance or ecosystem team; do not assume a direct NVIDIA integration is required.
5. Expand to lenders and infrastructure funds using the same independently verifiable evidence package.

## What Keel must not claim

- That an asset is legally owned or unencumbered solely because a data source says so.
- That a contract is enforceable or a borrower creditworthy.
- That utilisation guarantees revenue or debt repayment.
- That a model-generated forecast is observed cash flow.
- That a Keel assessment is a credit rating, valuation, audit opinion or regulatory certification.
- That NVIDIA endorses, uses, integrates with or partners with Keel unless a formal agreement exists.
