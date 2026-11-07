# Temporal Clearinghouse — legal-to-ledger interface and risk controls

## Correct classification
This product is a bilateral/tri-party forward production and service-delivery financing workflow. It is not an ACH smart contract, CDO, AMM or proof-of-compute consensus protocol. ACH is a bank payment rail; a smart contract may create payment instructions only through an appropriately authorised payment provider. A pool of forward contracts is not automatically a securitisation or CDO.

## Contract parties and separate rights
- Buyer: owes payment under a signed purchase agreement, subject to acceptance, set-off, termination, insolvency and dispute terms.
- Compute provider: owes defined service delivery and remedies for failure.
- Financier/advance provider: funds an advance and receives only the repayment rights expressly assigned or secured.
- Collateral provider: grants a separately documented security interest or escrow right, if legally valid and perfected.
- Platform/operator: calculates, records, reconciles and reports; it does not become lender, custodian, escrow agent, payment processor or collateral agent by software design alone.

## Required contract-to-code fields
Agreement ID and version; legal entity IDs; governing law and forum; service unit and benchmark; quantity and delivery windows; minimum quality and SLA; metering method and independent auditor; customer acceptance and dispute window; price, tax, currency and invoice terms; payment due date and payment rail; buyer credit support; assignment/novation/consent; set-off and termination; provider replacement rights; force majeure; insolvency treatment; refunds and service-credit treatment; data/security obligations; dispute process; collateral identity, owner, custodian, priority, perfection, permitted enforcement and release conditions.

## Cash and liability waterfall
1. Record delivery only after independently verifiable metering and buyer acceptance (or an explicitly adjudicated deemed-acceptance rule).
2. Record invoice separately from delivery; invoice is not cash.
3. Record buyer payment only after settlement evidence from the bank/payment provider.
4. Allocate cleared cash under the signed waterfall: taxes/fees if contracted, buyer refunds/disputes reserve, provider operating share, senior advance repayment, residual provider/institution distribution. The exact priority is contract-specific and must be legally reviewed.
5. Reduce outstanding advance only by cash actually received and allocated, or another explicitly documented repayment event. Do not burn debt merely because compute was delivered.
6. Keep service-credit obligations separate from cash balances and advance liabilities.

## Quantitative controls
Use exact integer minor currency units and integer service units. Never use binary floating-point for money. Underwriting ceiling must be the minimum of independently supported buyer cash/receivables, legally assignable contracted net cash flows, haircut-adjusted eligible collateral and provider deliverable-capacity limits, after reserves and prior commitments. Do not count the same buyer receivable, collateral asset, compute capacity or cash balance twice.

A discount or haircut is not proof of no-interest economics. A 10% discount, reserve or platform fee is an economic financing cost if it compensates for time or credit risk. Disclose APR/effective annualised cost where legally required and provide a full cash-flow schedule. Avoid "zero-interest" marketing until accounting, tax, Shariah (if relevant), lending, securities and consumer/institutional regulatory analysis is complete.

## Collateral and failure controls
Collateral is not automatically slashed or auctioned by code. Before any enforcement: verify security creation/perfection, owner authority, priority, jurisdiction, valuation, notice/cure rights, insolvency stays, sanctions, auction permissions and dispute outcomes. Use a regulated/qualified enforcement party and human dual approval. A token's market price is not a reliable collateral value or liquidation guarantee.

Compute provider collateral/performance bond and buyer advance collateral must be separate risk pools unless legal documentation explicitly establishes a permitted shared structure. Provider slashing compensates service failure only under a pre-agreed SLA and adjudication path; it does not automatically repay a financier's advance.

## Failure scenarios
Model buyer insolvency/default; provider insolvency; compute outage; power/network failure; quality failure; customer non-acceptance; invoice dispute; delayed/failed bank settlement; token depeg/illiquidity; collateral value collapse; custody breach; duplicate capacity sale; data centre concentration; benchmark manipulation; force majeure; legal prohibition; and correlated buyer/provider failures. Stress both liquidity timing and ultimate loss.

## Prototype implementation boundary
The module `src/temporal-clearinghouse.js` is a deterministic ledger simulation. It:
- rejects advances exceeding gross contract value or haircut-adjusted stated collateral value;
- reserves only evidenced capacity and prevents over-reservation;
- accepts delivery only with verified metering and customer acceptance;
- separates delivery, invoice-like contract value, settled buyer cash and advance repayment;
- requires dual-control evidence for cash allocation;
- reports collateral coverage without claiming legal enforceability.

It does not custody funds, lock collateral, mint tokens, run a payment rail, verify legal documents, enforce a lien, slash collateral, execute a loan, or connect to compute networks. Production requires a persistent source registry, immutable database ledger, contract/legal approval, regulated partners and independent security review.
