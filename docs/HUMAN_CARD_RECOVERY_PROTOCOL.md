# Keel Human Card — Independent Recovery Protocol
Status: database/API foundation; recovery service and verified identities are not production-ready.

## Purpose
A lost or compromised physical Human Card must not let an attacker restore access through a single password reset, support agent or tenant administrator. Recovery is a governed process involving independent, externally verified trustees and a mandatory delay. Recovery never restores the lost card and never independently activates a virtual payment credential.

## Group configuration
The cardholder creates a recovery group with 2–7 distinct trustees, a threshold of at least 2, and a delay between 24 and 168 hours. The owner cannot approve their own recovery. Every trustee must be an active principal with `identity_assurance='externally_verified'`. The owner and trustees are tenant-bound. A browser cannot assert external verification; that status must be supplied by a trusted identity provider integration.

## Lost-card path
1. The authenticated owner opens a recovery request with a reason code.
2. Keel immediately marks the old device `lost` and lifecycle `locked`; future pairing and high-risk authorisations remain disabled.
3. Each distinct trustee may approve or reject once.
4. A rejection blocks the request. A threshold of approvals moves it to `approved_waiting_period` and sets the delay from the group policy snapshot.
5. Only after the delay has elapsed can the owner finalise the request.
6. The request becomes `replacement_pending`. The old card remains lost. A trusted partner must provision a replacement physical card, which must pass delivery verification, hardware attestation and fresh pairing.
7. Recovery setup and testing must be completed again before the virtual channel can become eligible. Issuer provisioning and trusted funding checks remain separate.

## API
- `POST /api/human-card/recovery/groups`: create a group using externally verified trustee principal IDs, threshold and delay hours.
- `POST /api/human-card/recovery/requests`: lock the card and open recovery.
- `POST /api/human-card/recovery/requests/{requestId}/approvals`: trustee decision.
- `POST /api/human-card/recovery/requests/{requestId}/finalise`: owner finalises after the delay.

Every endpoint requires a tenant API credential linked to a named principal. All database queries are tenant-scoped. Recovery transitions are recorded in the Keel Authority Chain.

## Limitations
- Existing principal creation marks identities self-asserted. An OIDC/identity-proofing integration is required to create externally verified trustees; there is no self-service way to elevate this flag.
- Notification delivery, trustee invitation/consent, identity proofing, appeal/dispute workflow, emergency support procedures and fraud monitoring remain to be implemented.
- A database/API policy foundation is not a substitute for legal identity verification, secure account recovery or an operational recovery desk.
- Migrations 007–009 are not applied to Railway. No live card is issued and no virtual card is activated by this workflow.
