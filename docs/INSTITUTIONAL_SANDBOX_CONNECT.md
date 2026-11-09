# Connecting an Institution to Keel Sandbox

## Integration objective

Connect an institution's non-production environment to a private Keel workspace so both parties can validate data mapping, accounting invariants, reconciliation behavior and operational exceptions without replacing the institution's core systems.

## Supported integration patterns

1. **REST/OpenAPI:** request/response integrations with versioned contracts and scoped credentials.
2. **ISO 20022:** versioned message adapters; preserve source message and mapping lineage.
3. **Secure file exchange:** statement, ledger extract and reconciliation batch import/export with checksums, manifests and replay protection.
4. **Webhooks/event streams:** signed events, idempotency keys, replay windows and event ordering metadata.
5. **Institution-hosted connector agent:** runs inside institution-controlled infrastructure and initiates outbound-only connections where inbound connectivity is not permitted.

## Institution-controlled onboarding

1. Name an accountable technical owner and business/control owner.
2. Define use case, systems, message families, data classification and legal entity/book scope.
3. Select Public Test Lab or private Institutional Integration Lab. Never send confidential records to the public lab.
4. Establish workspace identities, least-privilege roles, credentials and key rotation.
5. Agree schema/mapping version, clock assumptions, retry/idempotency behavior and error handling.
6. Start with synthetic fixtures; then use only data explicitly approved and masked by the institution.
7. Run baseline and adversarial scenarios, review KFTR evidence and defects.
8. Agree pilot scope and separate regulatory/legal approvals before any real-world pilot.

## Security expectations

- TLS in transit; mutual TLS or institution-approved equivalent for service-to-service.
- Scoped credentials and short-lived tokens where feasible.
- Secrets stored outside code, fixtures, browser bundles and evidence exports.
- Per-tenant isolation and access logs.
- Signed webhook verification over raw payload and timestamp, unique event IDs and replay protection.
- Explicit data retention and deletion policy.
- Connector disable/revoke mechanism and incident contact.
- No production credentials in sandbox.

## Financial correctness expectations

- Do not equate a statement balance with available funds.
- Preserve currency code, precision and source timestamp.
- Preserve payment lifecycle states and original source references.
- Reconciliation must expose missing, duplicate, partial, delayed and reversed records.
- Do not infer legal ownership, collateral priority or settlement finality from a checksum or API response alone.

## Pilot boundary

A Keel sandbox result is a technical test record, not regulatory approval, audit opinion, accounting sign-off or permission to execute transactions. Controlled pilots require institution approval and any applicable regulator permission, contracts, security assessment, data-processing terms, liability allocation and rollback plan.
