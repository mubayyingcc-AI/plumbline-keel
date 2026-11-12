# Keel implementation gap register

Snapshot: 9 November 2026. This is a code/repository assessment, not a production certification. Status terms:
- **Foundation present**: some code exists, but the end-to-end institutional capability is not complete.
- **Simulation only**: deterministic local logic, no real financial execution or independently verified external data.
- **Not implemented / not verified**: no sufficient implementation evidence found in the current repository review.
- **External gate**: cannot be completed by code alone; requires partner, licensed provider, independent assessor, legal/accounting opinion or regulatory permission.

| Domain | Current evidence in repository | Status | Completion work required |
|---|---|---|---|
| Financial state | `src/financial-state.js`, financial object API and tenant-scoped storage | Foundation present | Source adapters, event-time/valid-time model, entity/account hierarchy, reconciled balances, valuation, lifecycle and robust multi-currency state |
| Collateral integrity | Encumbrance fields, availability holds, relationship references and capacity calculation | Foundation present | Asset identity/registry integrations, legal ownership/priority evidence, pledge/charge registry, cross-facility reservations, reuse controls, release workflow, haircut governance and dispute resolution |
| Double-entry accounting | No production journal/ledger engine identified | Not implemented | Chart of accounts, journal batches, debit/credit balancing, posting periods, reversals, trial balance, subledger reconciliation, multi-entity accounting and independent accounting review |
| Treasury / liquidity / ALM | Fracture assessment can accept declared liquidity and exposure inputs | Simulation only | Bank/cash position aggregation, intraday liquidity, forecast, funding ladders, maturity gaps, contingency funding, interest-rate risk and reconciliation |
| Credit and counterparty risk | Temporal capacity ceiling and scenario exposure arithmetic | Simulation only | Facility/limit management, obligor identity, ratings/evidence, covenant engine, PD/LGD/EAD governance if used, concentration, collateral allocation, watchlists and human underwriting |
| FX and market risk | Currency instrument reference catalogue; exact minor-unit helpers | Simulation only | Market-data provenance, FX quote/valuation, rate curves, position aggregation, sensitivity/stress, stale-price controls and regulated execution partner where needed |
| Payments, clearing and settlement | Currency transfer intents and Temporal Clearinghouse state simulation | Simulation only | Payment initiation connector, clearing/settlement lifecycle, finality rules, idempotency, returns/reversals, bank statement reconciliation, sanctions/fraud boundaries and partner certification |
| Securities and custody | No complete securities/custody lifecycle engine identified | Not implemented | Instrument master, positions, custody statements, corporate actions, settlement instructions/status, asset servicing, custody source verification and custodian integration |
| Trade finance and receivables | Temporal contract/capacity model supports future contracted services | Simulation only | Invoice/PO lifecycle, receivable validation, dilution/dispute checks, assignment/notice, letters of credit/guarantee evidence, factoring controls and legal enforceability review |
| Public finance | No dedicated public finance module identified | Not implemented | Appropriations, budget authority, commitments, procurement, grant disbursement, public debt service, public asset registers, treasury single-account integration and public audit requirements |
| Insurance and guarantees | No dedicated insurance/guarantee engine identified | Not implemented | Policy/coverage data, exclusions, limits, claims, recoverability, insurer credit risk and broker/insurer integrations |
| Programmable currency / service credits | Instrument catalogue and non-executable transfer intents | Simulation only | Issuer/redemption evidence, legal classification, reserve/custody evidence, entitlement lifecycle, transfer restrictions, reconciliation and approved settlement rails |
| Temporal productive-capacity finance | Capacity calculator and Temporal Clearinghouse state machine | Simulation only | Persistent transactional facility ledger, signed contract validation, verified provider metering, customer acceptance, receivable assignment, cleared cash proof, repayment allocation and insolvency/legal review |
| AI-agent financial authority | Tenant principals, roles and expiring delegation foundations | Foundation present | Strong identity, scoped mandates, instrument/beneficiary limits, velocity controls, approval workflows, policy freshness, execution adapter boundaries, revocation propagation and action reconciliation |
| Financial fracture and continuity | `src/fracture-engine.js`, tenant-scoped scenario assessments | Simulation only | External data feeds, dependency graph governance, calibrated scenarios, correlated shock testing, incident integration, recovery orchestration and institution-approved continuity procedures |
| Regulatory assurance | Regulatory engine, tenant schema/API, Article 17 profile, findings/actions/dockets | Foundation present | Trusted evidence connectors, complete procedures, full standards/legal crosswalk, approvals, regulatory feeds, signed exports, complete UI and independent legal review |
| Institutional integration | REST API/OpenAPI and structured CSV pathways | Foundation present | Bank/custodian/ERP/market/government connectors, OAuth/mTLS, consent, signed webhooks, replay protection, schema registry, retries, reconciliation, contract tests and certification |
| Security / identity | Tenant API keys, hashed secrets, role checks and Authority Chain | Foundation present | OIDC/SAML SSO, MFA, service identities, fine-grained permissions, key rotation, managed secrets, validated proxy trust, distributed rate limiting, CSRF strategy, secure CSP, encryption/KMS and independent penetration test |
| Data governance / privacy | Tenant scoping foundations and evidence classifications | Foundation present | Data inventory, lawful basis, residency, retention/deletion, minimisation, data-subject processes, legal holds, export access controls and privacy impact assessment |
| Reliability / operations | PostgreSQL pool and migrations/runtime DDL | Foundation present | Migration runner, DB integration tests, backups/restore drills, RPO/RTO, HA, monitoring, alerting, SLOs, incident runbooks, load/concurrency testing and disaster recovery |
| Government / institutional certification | No external certification or integration acceptance evidence | External gate | Government architecture/security assessment, procurement/security accreditation, regulator permissions and partner-specific certification |

## Non-negotiable financial invariants

- Never conflate reported balance, reconciled balance, available balance, liquidity and legally enforceable collateral.
- Never infer ownership, title, priority, absence of liens or recoverability from a supplied record or hash.
- No double counting across accounts, entities, facilities, currencies or collateral pools.
- No floating-point arithmetic for monetary amounts; preserve currency-specific minor-unit precision.
- Distinguish payment instruction, accepted instruction, clearing, settlement, reconciliation and finality.
- A future contract, forecast, service credit or token reference is not cash.
- No client funds custody, private-key custody, lending, FX dealing, collateral liquidation, money issuance or payment execution without explicit legal authority, regulated partners and separate release approval.
- AI can assist analysis but cannot silently authenticate evidence, accept residual risk or approve financial execution.

## Release rule

A module moves from foundation/simulation to production candidate only after deterministic domain tests, PostgreSQL integration tests, tenant-isolation tests, concurrency/idempotency tests, external-source authentication, failure/recovery testing, security review, operational runbooks and legal/accounting review appropriate to the activity. External institutional acceptance remains a separate gate.
