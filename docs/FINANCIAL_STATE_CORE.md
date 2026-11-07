# Keel Financial State Core v1

A tenant-scoped canonical record for cash accounts, deposits, collateral assets, receivables, liabilities, commitments, restrictions and provider service credits.

## Availability
An available amount is computed only for eligible value types with active lifecycle, verified evidence, fresh observation time, known encumbrance and no declared duplicate or expiry. Unknown values are null with explicit hold reasons. Totals are separated by currency or service unit; no FX conversion is implied.

## API
- POST /api/financial-state/objects — tenant-authenticated owner/admin/integration write; stores object and Authority Chain event in one transaction.
- GET /api/financial-state/objects — tenant-authenticated snapshot with policy and hold reasons.

## Controls and limitations
- Exact integer atomic units; no floating point money arithmetic.
- Source/external reference uniqueness is tenant-scoped.
- AI-inferred, estimated, stale, disputed, unknown-encumbrance or duplicate records cannot contribute to available value.
- Evidence status is supplied metadata, not independent authentication.
- No assertion of legal title, priority, custody, lien status or redemption rights.
- Advisory only; no payment, transfer, lending, liquidation or settlement.
