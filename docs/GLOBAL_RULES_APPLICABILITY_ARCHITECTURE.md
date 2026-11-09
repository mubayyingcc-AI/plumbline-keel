# Keel Global Rules & Applicability Layer

**Status:** Engineering design and discovery data; not a legal service.

## Global design
Keel has one jurisdiction-neutral financial core. Jurisdictional requirements are versioned overlays, not country-specific forks. Applicability depends on legal entity, licence, institution type, activity, product, customer/data category, outsourcing/cloud role, cross-border processing, sub-jurisdiction and effective date.

## Instrument taxonomy
Classify each source as law, regulation, supervisory instruction, government policy, supervisory guidance, international standard, industry standard, institution policy or contractual obligation. Preserve issuing authority, source URL, language, version, publication/effective dates, transition dates, binding scope, amendments and supersession lineage. ISO 20022, ISO 4217, IFRS, IPSAS, ISO/IEC 42001 and NIST AI RMF are not automatically laws; applicability depends on adoption, contract, supervisor or institutional policy.

## Engines
1. Global Rules Registry — immutable source versions and provenance.
2. Applicability Engine — returns reasoned candidates and uncertainty, never legal conclusions.
3. Control Mapping Engine — maps approved obligations to actual deterministic Keel controls/tests.
4. Regulatory Change Intelligence — versions amendments and identifies affected profiles, tests and historic evidence.
5. Evidence Requirements Engine — owner, source, freshness, integrity, reviewer and sufficiency.
6. Human Approval Workflow — institutional legal/compliance approval, exceptions and review cadence.

## KRAR
Keel Regulatory Applicability Record captures legal entity, jurisdiction/sub-jurisdiction, instrument/version, legal status, effective date, activities/data in scope, reasoning, unresolved questions, reviewer, approver, approval evidence, mapped controls, evidence references, review due date and supersession lineage.

Evidence chain: source/version → KRAR → approved control map → scenario → KFTR → institutional decision.

## Initial discovery scope
All six GCC members (Saudi Arabia, UAE, Qatar, Bahrain, Oman, Kuwait), Nigeria and the United Kingdom. Discovery profiles are intentionally research-pending and incomplete. Separate sub-jurisdictions are represented where relevant. Expand to EU, Singapore and further markets after source-governance is operational.

## Financial core integration
Currency registry is effective-dated and source-versioned; historical precision, redenomination and withdrawn codes must be supported. Currency precision must not be assumed to be two decimal places. Ledger accounting roadmap includes legal entities/books, chart governance, accounting periods, controlled backdating/reopening, trial balance, statements, intercompany, FX revaluation, consolidation, audit adjustments, reconciliation and close sign-off.

## Applicability states
CANDIDATE_REQUIRES_HUMAN_REVIEW, APPROVED_APPLICABLE, APPROVED_NOT_APPLICABLE, UNRESOLVED, SUPERSEDED. Current implementation emits candidates only. KRAR approval requires named human approver, timestamp and approval evidence.

## Forbidden shortcuts
- No national fork of the core.
- No blanket country-wide applicability.
- No AI compliance declaration or self-approval.
- No standards represented as law without adoption basis.
- No deletion/rewriting historic source or evidence versions.
- No hash treated as proof of title, funds or settlement finality.
- No complete-coverage, certification or legal-advice marketing claims.

## Production gates
Official source verification, licensed ingestion, multilingual legal review, institutional approval, change management, deterministic testing, access control, immutable audit storage, retention/legal hold, backup/restore and independent security review.
