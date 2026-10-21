# x402 sponsorship payments

The relay supports optional x402 v2 `exact` payments through an external facilitator.
Set `X402_ENABLED=true` and configure `X402_FACILITATOR_URL`, `X402_RESOURCE_URL`
(the public canonical sponsorship URL), `X402_NETWORK` (CAIP-2), `X402_AMOUNT`
(positive integer token base units), `X402_ASSET`, and `X402_PAY_TO`.
`X402_EXTRA` accepts JSON token metadata required by the facilitator. See `.env.example`.

Both POST `/v1/sponsorships` and its legacy alias `/v1/sponsor` require payment.
Quotes, status, discovery, and health endpoints remain accessible. Missing payment
returns HTTP 402 with a base64 JSON `PAYMENT-REQUIRED` header and matching JSON body.
Retry the same sponsorship body with a base64 JSON x402 v2 `PAYMENT-SIGNATURE`.
The selected `accepted` requirements must match the challenge exactly. Browser
clients can send the payment header and read both payment response headers using CORS.

The relay calls the facilitator's `/verify`, validates the signed Stacks transaction
and quote, reserves the quote, and simulates the sponsored transaction. It then calls
`/settle` before broadcasting. Settlement failure prevents broadcast; successful
settlement adds a base64 JSON `PAYMENT-RESPONSE` receipt, including on a later
broadcast error. The facilitator validates cryptographic authorization, expiry,
and on-chain replay protection. Use a facilitator supporting the configured asset
and network; this integration does not introduce a native Stacks payment scheme.

This is an **additional service payment**. Existing atomic sBTC/USDCx sponsor
reimbursement remains required by the transaction policy. Payment settlement and
Stacks broadcast are separate operations: a broadcast failure can leave a payment
settled. There is no automatic refund. Keep the receipt and retry the identical
request; payment bindings and receipts are persisted in `X402_STORE_PATH`, so
settled payments are reused only for that request. Unknown settlement outcomes
must be reconciled with the facilitator. The CLI defaults to `.ossr/x402-payments.json`;
programmatic users must supply `storePath` for persistence. Run one process per
store, retain it across restarts, and back it up with the quote store. The store
has a 10,000-payment capacity and fails closed when full; archival requires an
operator retention policy consistent with the facilitator's replay guarantees.

Protocol reference: https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md

Run `npm run test:x402` for payment and HTTP integration tests.
