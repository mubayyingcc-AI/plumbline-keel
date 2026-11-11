# Research & Integration Lab

The public Research & Integration Lab separates three domains:

1. OpenBB ODP V5 connectivity. Keel can probe a customer-managed HTTPS OpenBB API endpoint using only its public OpenAPI descriptor. It does not forward credentials, query arbitrary routes, or ingest provider data in this initial adapter.
2. G2 technology research. G2 is an internal research integration subject to the connected account's access rights and G2 terms. No sandbox buyer-intent output is exposed publicly.
3. Keel assurance. Public demonstrations use synthetic fixtures and the existing Keel test endpoints. They are not financial advice, certification, or transaction authority.

## OpenBB configuration

Set `OPENBB_API_BASE_URL` only on the Keel server, using the customer-managed OpenBB ODP V5 HTTPS origin. Do not place credentials in the URL. The status probe requests only `/openapi.json`, rejects redirects, has a short timeout, and never returns the endpoint URL to a browser. A successful probe establishes reachability only—not provider licensing, entitlement, data freshness, accuracy, or permission to redistribute.

OpenBB V5 software is Apache-2.0. Provider data remains subject to each provider's own terms. No provider data is fetched, stored, cached or republished by this adapter.

## Security boundary

Do not send source code, private architecture, database details, signing keys, customer/tenant records, internal evidence, or recovery material to G2, OpenBB, or any third-party integration. Use synthetic fixtures and approved public data only. Keep G2 credentials and OpenBB provider credentials outside the browser and outside public website responses.

## Acceptance criteria

- Unconfigured endpoint returns `not_configured` without outbound network access.
- Non-HTTPS or credential-bearing endpoint is blocked.
- Probe requests only `/openapi.json`, rejects redirects, and times out quickly.
- Public response never includes the configured endpoint or secrets.
- OpenBB reachability is not represented as data-source validation.
- G2 is not represented as a free public data feed or commercial partnership.
