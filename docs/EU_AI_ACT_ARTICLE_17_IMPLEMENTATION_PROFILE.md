# EU AI Act Article 17 implementation profile (Keel)

Profile status: controlled regulatory reference profile, not legal advice or a conformity assessment. Legal owner approval is required before a tenant treats an obligation as applicable or a mapping as sufficient.

## Source baseline

- Regulation (EU) 2024/1689, consolidated text dated 27 July 2026: https://eur-lex.europa.eu/eli/reg/2024/1689/2026-07-27/eng
- European Commission AI Act Service Desk, Article 17: https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-17
- Commission Implementing Decision (EU) 2026/2274, harmonised standards supporting Regulation (EU) 2024/1689: https://eur-lex.europa.eu/eli/dec_impl/2026/2274/oj
- Commission announcement of EN 18286:2026, published 19 October 2026: https://digital-strategy.ec.europa.eu/en/library/first-harmonised-standard-supporting-ai-act-published-official-journal

The consolidated AI Act text is a documentation tool; the Official Journal legal acts prevail. RegulatoryChangeWatch must monitor the Official Journal, EUR-Lex and Commission standardisation publications and retain source snapshots/provenance.

## Applicability guardrails

1. Article 17(1) is directed at **providers of high-risk AI systems**. A company merely selling an AI product to a financial institution is not automatically subject to every provider obligation: determine whether it is the provider, deployer, importer, distributor or another operator under the facts and legal definitions.
2. Determine high-risk classification under Article 6 and Annexes I/III, intended purpose, product role, placing-on-market/putting-into-service facts, jurisdiction, applicable dates and any relevant exclusions or transitional provisions.
3. Article 17(2) requires proportional implementation for organisation size (including SMEs/start-ups/SMCs) but does not lower the required protection or rigour.
4. Article 17(3) permits integration of Article 17 aspects into an equivalent quality-management system required under relevant Union sectoral law. It does not mean ISO/IEC 42001 certification alone proves Article 17 compliance.
5. Article 17(4) is a specific rule for **providers that are financial institutions subject to internal-governance requirements under Union financial-services law**. For those qualifying providers, QMS obligations are deemed fulfilled through compliance with the applicable internal-governance rules, taking harmonised standards into account, **except Article 17(1)(g), (h) and (i)**. Those three areas remain to be addressed. Do not apply this carve-out to all financial institutions, to a bank's AI vendor merely because the customer is a bank, or to a deployer without determining the legal role.
6. EN 18286:2026 is the first harmonised standard referenced by Commission Implementing Decision (EU) 2026/2274 for the Article 17 QMS requirements. Implementing it can provide a presumption of conformity for requirements it covers, subject to the legal conditions and scope. It does not itself certify the AI system, replace the AI Act, or prove obligations outside its scope.
7. EN 18286 and ISO/IEC 42001 are not interchangeable. ISO/IEC 42001 is an organisation-level AI management-system standard; EN 18286 is tailored to the provider QMS for EU AI Act regulatory purposes and high-risk AI system lifecycle. They may be integrated. Keel must store licensed clause-level content and the organisation's actual certification scope before offering a detailed crosswalk. Do not reproduce the copyrighted EN standard in Keel or infer its clauses from marketing summaries.

## Article 17(1) obligation catalogue

Each row below is a high-level legal obligation locator and operational evidence expectation. It is not a substitute for the complete law or EN 18286 text.

| Locator | Required operational subject | Evidence classes Keel should support |
|---|---|---|
| 17(1)(a) | Regulatory compliance strategy; conformity-assessment procedures; controlled modifications | Regulatory applicability decision, role analysis, conformity-assessment plan, change request, impact assessment, approval and release history |
| 17(1)(b) | AI system design, design control and design verification | Intended-purpose specification, design baselines, architecture decisions, design reviews, verification results and traceability |
| 17(1)(c) | Development, quality control and quality assurance | Development procedures, quality gates, supplier/developer records, code/model build provenance, defect records and release approvals |
| 17(1)(d) | Examination, testing and validation before, during and after development, including frequency | Test strategy, plans, test datasets, acceptance criteria, test execution logs, validation reports, regression schedules and exceptions |
| 17(1)(e) | Technical specifications and standards; alternative means where harmonised standards are not fully applied or do not cover relevant requirements | Standards register, licensed clause mappings, applicability decisions, deviation rationale, alternative control evidence and technical specifications |
| 17(1)(f) | Data-management systems and procedures across acquisition, collection, analysis, labelling, storage, filtration, mining, aggregation, retention and related operations | Dataset inventory, provenance, lawful-use basis references, quality profiles, labelling instructions, representativeness analysis, access/retention/deletion logs and supplier data controls |
| 17(1)(g) | Article 9 risk-management system | Risk-management plan, hazard/risk register, estimation/evaluation, treatment, residual risk, testing, post-deployment feedback and accountable approvals |
| 17(1)(h) | Article 72 post-market monitoring system | Monitoring plan, performance and risk indicators, data sources, monitoring reports, thresholds, escalation, corrective/preventive actions and periodic review |
| 17(1)(i) | Article 73 serious-incident reporting procedures | Incident taxonomy, detection/triage, severity and timing decisions, evidence preservation, notification workflow, authority correspondence and follow-up |
| 17(1)(j) | Communications with competent authorities, data-access authorities, notified bodies, other operators, customers and interested parties | Stakeholder register, communication responsibilities, approved notices, requests/responses, delivery receipts and correspondence retention |
| 17(1)(k) | Record keeping of relevant documentation and information | Records inventory, immutable versions, retention schedules, retrieval tests, access logs, legal holds, export manifests and chain-of-custody |
| 17(1)(l) | Resource management, including security of supply | Skills/competence records, infrastructure capacity, supplier inventory, dependency concentration, continuity plans, substitution analysis and supplier assurance |
| 17(1)(m) | Accountability framework for management and staff | Responsibility matrix, named accountable owners, role descriptions, delegation, competence, management review, approval evidence and escalation paths |

## Linked AI Act obligations

Article 17 is a QMS requirement, not the entire high-risk AI regime. Applicability analysis should link, where relevant:
- Article 9: risk-management system.
- Article 10: data and data governance.
- Article 11 and Annex IV: technical documentation.
- Article 12: record-keeping/logging capability.
- Article 13: transparency and information to deployers.
- Article 14: human oversight.
- Article 15: accuracy, robustness and cybersecurity.
- Article 18: documentation retention and availability.
- Article 19: automatically generated logs under provider control.
- Article 20: corrective actions and duty to inform.
- Article 26: deployer obligations, where the organisation is a deployer.
- Article 43: conformity-assessment procedures.
- Article 72: post-market monitoring.
- Article 73: serious-incident reporting.
- Annex VII: QMS and technical-documentation assessment route where applicable.

The applicability engine must not flatten provider and deployer duties into one generic checklist.

## ISO/IEC 42001 relationship

Keel must support a controlled many-to-many crosswalk between:
- the organisation's verified ISO/IEC 42001 certificate and defined scope;
- the licensed ISO/IEC 42001 clauses/controls the organisation actually uses;
- EN 18286:2026 requirements within its licensed scope;
- Article 17 legal obligation versions;
- the provider's AI system and lifecycle;
- operating controls, owners, tests and evidence.

A shared theme is not proof of equivalence. Each proposed mapping requires a rationale, scope match, gap assessment, evidence and reviewer approval. Do not mark a legal obligation as satisfied solely because an ISO control has a similar title.

## Required Keel workflow

1. Record the AI system, provider/deployer role, intended purpose, risk classification, entity and jurisdiction.
2. Generate a dated applicability assessment with legal reviewer approval.
3. Load the correct Article 17, harmonised standard and sectoral governance versions.
4. Import an organisation's ISO/IEC 42001 scope and licensed crosswalk references, if provided.
5. Map each obligation to one or more controls and each control to accountable owners, operating procedures and test frequencies.
6. Link evidence with provenance, verification method, validity period and independent review.
7. Evaluate design adequacy separately from operating effectiveness.
8. Create findings for missing/expired/contradictory evidence, failed tests, unowned controls, unapproved deviations and overdue actions.
9. Require independent remediation verification and preserve prior assessment snapshots.
10. Export a scoped evidence dossier with all gaps, exclusions, assumptions, versions and review approvals. The dossier is not a certificate or declaration of conformity.

## Article 17(4) decision tree

- Is the entity legally a provider of a high-risk AI system? If no, do not apply the provider Article 17 QMS rule without separate legal basis.
- Is it a financial institution within the relevant Union financial-services law definition and subject to internal-governance requirements under that law? If no, do not use the Article 17(4) deemed-fulfilment route.
- Has qualified counsel identified the exact applicable internal-governance rules and their scope? If no, applicability remains unresolved.
- Even where Article 17(4) applies, explicitly assess Article 17(1)(g), (h) and (i), which are excluded from the deemed-fulfilment provision.
- Record the reasoning, legal sources, reviewer, date and any residual controls. Never infer an exemption from customer industry or company name.

## Acceptance criteria

- Provider/deployer/importer/distributor role and high-risk classification are explicit and reviewer-approved.
- Article 17 clauses (a)–(m) exist as separately versioned obligation records.
- Article 17(4) is modelled with its exact scope and (g)/(h)/(i) exceptions.
- Standards are distinguished from binding law, guidance, internal policies and contractual obligations.
- EN 18286 and ISO/IEC 42001 are separately versioned and never treated as interchangeable.
- No unsupported ISO-to-EN or ISO-to-Article-17 equivalence is generated.
- Every mapping can be traced to evidence, control owner, test, version and reviewer.
- Regulatory updates create impact assessments and do not mutate historical dockets.
- Dockets disclose gaps and cannot self-assign a certification or compliance status.
- Qualified EU legal/standards review signs off the production profile.
