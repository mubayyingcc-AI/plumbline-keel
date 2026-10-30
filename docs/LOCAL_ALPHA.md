# Keel Core Alpha 0.2

Implemented: local HTTP API; versioned policy capacity calculation; evidence freshness checks; conservative HOLD for stale/conflicting/duplicate-linked/unknown-encumbrance cases; explicit authorization check; decision record and SHA-256 fingerprints; automated synthetic tests (19 passing). Aggregate numeric overflow is rejected. Missing or null encumbrance makes the affected asset's eligible value unavailable; aggregate encumbrance and capacity are also unavailable whenever any asset has unknown encumbrance.

Example: $10,000,000 gross less $2,000,000 encumbrance = $8,000,000; a 10% haircut yields $7,200,000. A $7,500,000 request is held by $300,000.

Limitations: no external integrations; evidence metadata is caller-supplied and unauthenticated; duplicate detection only flags explicit `duplicateOf`; fingerprints are not signatures or a tamper-proof ledger; API binds to loopback; ALLOW only means this prototype's declared checks passed. Do not submit real financial data or use it for live transaction authorization.

Run `npm test` and `npm start`; open `http://127.0.0.1:3000`. Endpoints: GET `/api/health`, GET `/api/demo`, POST `/api/evaluate`.