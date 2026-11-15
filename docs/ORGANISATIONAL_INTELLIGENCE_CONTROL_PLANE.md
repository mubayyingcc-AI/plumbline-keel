# Keel Organisational Intelligence Control Plane

**Status:** v1 engineering foundation on an isolated development branch. Not production-ready; no external connector is connected or permitted to execute actions through this release.

## Product role

Keel extends its existing Decision & Evidence Infrastructure into a cross-organisation control plane for AI agents, service principals, plugins and delegated tool use. It does not replace identity providers, application permissions, workflow engines or systems of record.

The governing rule is: **a model may propose; a named principal and a current human-issued mandate provide authority; deterministic Keel policy evaluates; the connected system executes; Keel preserves evidence.** Model output is never an authorization source.

## Reuse rather than duplicate

- Existing tenants, principals and tenant API keys remain the identity and tenancy foundation.
- Existing Authority Envelopes remain the human-granted, expiring, resource-scoped authority source.
- Existing authority action approvals remain independent human approval records bound to the exact request fingerprint.
- Existing Action Proof Objects remain durable authorization evidence.
- Existing Assurance Fabric and tenant event chain remain the wider evidence lineage.
- AI Release Assurance continues to bind exact model, prompt, retrieval, tool, workflow, policy and runtime versions to release checks.
- Provider lifecycle/outbox/inbox remains the financial provider workflow; it is not repurposed as a generic plugin executor.

## Capability manifest

Every registered integration is bound to a tenant-owned ai_agent or service principal and an immutable manifest fingerprint. Each operation declares its capability type (read, analyse, create, modify, communicate, approve, execute, delete), explicit resource types, risk tier, side-effect status, human-approval requirement and evidence requirement. Wildcard resource types are forbidden.

A declaration is not proof that the plugin actually behaves as declared. Registration must be reconciled with the vendor's real permission model, OAuth scopes, API methods and runtime traffic.

## Authorization sequence

1. The organisation registers an integration against a named Keel principal.
2. A human administrator creates an Authority Envelope for that principal, with exact scope integration:tool:invoke and both resource integration:<integrationId> and the exact target resource ID, plus validity bounds and an explicit approver when required.
3. The integration authenticates with its own tenant key; caller-supplied agent names are not trusted.
4. The action request binds tenant, integration, manifest fingerprint, principal, operation, resource type, resource ID, payload fingerprint, request ID and envelope. If an amount limit applies, the exact integer-string amount and ISO currency must also match the canonical action payload.
5. Keel checks that operation and resource type are declared and the integration, principal and tenant are active.
6. Existing Authority Envelope evaluation checks grantee, expiry, scope, resource, revocation and any amount/currency constraints. The request fingerprint is used for independent human approval.
7. Keel writes the existing Action Proof Object and a tenant-scoped control action record. A changed payload creates a different fingerprint and cannot reuse an earlier approval.

## Enforcement boundary

The v1 API can register capabilities and evaluate/persist authorization decisions. It does **not** dispatch external plugin actions and returns execution NOT_EXECUTED. A decision record is not a connector execution token.

To make enforcement real, each supported integration must use a Keel-mediated adapter/gateway or an equivalent platform-native enforcement point. Credentials must be scoped so the agent cannot bypass Keel with direct API access. If a plugin retains unrestricted direct credentials, Keel cannot guarantee every action passes through the control plane. Native application permissions, egress policy and credential vaulting are part of each connector's acceptance test.

## Required connector contract

A production adapter must authenticate the external workload identity; expose a fixed operation-to-API mapping; hold credentials outside model context and browser storage; submit exact resource and payload fingerprints before side effects; require a short-lived request-bound authorization artifact before dispatch; return a signed or independently authenticated outcome with provider request ID and idempotency key; distinguish accepted, completed, failed, unknown and reconciled states; never retry unknown side effects without reconciliation; support revocation, suspension, emergency stop and credential rotation.

## Explicitly not included in v1

No live Microsoft 365, Google Workspace, Salesforce, Slack, ERP, HR, CRM, cloud, bank, custodian or government connector is connected. No external tool action is executed by the public website demo. No guarantee is made against bypass when customers retain direct credentials. Production requires independent security review, connector-specific tests, key lifecycle, rate/cost limits, concurrency/replay testing, incident response and customer approval.


## Relationship to PositionSeal and financial evidence

PositionSeal is a specialised financial-position evidence format, not a second authority system. The existing draft implementation in PR #110 remains separate and is not merged or exposed through this control-plane API. When integrated, it should register as a typed evidence producer under the same tenant/principal and capability framework, and its signed position records should link to Keel's shared evidence lineage. Its issuer-key lifecycle, tenant-bound persistence, freshness policy, and proof-boundary semantics must be verified before that integration is enabled. Do not treat a PositionSeal signature as proof of legal title, priority, or unencumbered status beyond the issuer's declared source boundary.
