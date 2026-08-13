# OSSR operator (Day 3)

The testnet-only `OssrOperator` component owns one sponsor wallet. It checks its
STX balance, serializes sponsor nonce allocation, adds sponsor authorization,
broadcasts fully signed transactions, retrieves transaction status, and writes
structured JSON logs. It does not validate application policy or expose an HTTP
API yet; those are Day 4 work.

Configure `SPONSOR_PRIVATE_KEY`, `STACKS_API_URL`, and optionally
`OPERATOR_MINIMUM_BALANCE_MICROSTX` in `.env`, then run:

```sh
npm run operator:health
npm run operator:status -- <64-character-txid>
```

The reusable API is in `src/operator.ts`:

```ts
const sponsored = await operator.sponsor(originSignedBytes, 1_000n);
await operator.broadcast(sponsored.transaction);
const status = await operator.transactionStatus(sponsored.txid);
```

`sponsor()` must receive a complete origin-signed transaction whose authorization
type is sponsored. Each successfully signed transaction consumes a locally
reserved sponsor nonce, preventing concurrent calls in this operator process
from using the same nonce.

## Day 4 relay API

Start the local HTTP relay with:

```sh
npm run operator:serve
```

It listens on `127.0.0.1:3000` by default (`OPERATOR_PORT` overrides this) and
accepts `POST /v1/sponsor`:

```json
{ "transaction": "0x...", "user": "ST..." }
```

The relay validates the encoded testnet transaction, sponsored authorization,
origin signature, and claimed origin address; estimates its STX fee; verifies
operator health and balance; then signs and broadcasts it. The current PoC
policy accepts only sponsored STX token transfers. A successful response is:

```json
{ "status": "accepted", "operator": "ST...", "transaction_id": "...", "fee_microstx": "..." }
```

## Day 5 end-to-end CLI

With the relay running, submit an origin-signed transaction through the full
CLI → relay → operator → testnet flow:

```sh
npm run operator:client -- --wait
```

The CLI reads `.env.local` first (then `.env`), prints the fee, user, operator,
transaction ID, and confirmation time, and never receives the sponsor key.

## Day 7 reimbursement worker

Set `REIMBURSEMENT_PAYER_PRIVATE_KEY` to the isolated **testnet** account that
holds the sBTC used for reimbursement, then start the relay as usual. The
worker persists records to `.ossr/reimbursements.json` by default. It waits for
the sponsored transaction to reach `success`, calculates the configured integer
quote, and calls canonical testnet sBTC `transfer(amount, payer, operator,
none)`. The payer account must also have STX for
`REIMBURSEMENT_PAYMENT_FEE_MICROSTX` (default `10000`).

The pricing defaults match the Day 6 policy. They may be overridden with
`REIMBURSEMENT_RATE_NUMERATOR`, `REIMBURSEMENT_RATE_DENOMINATOR`,
`REIMBURSEMENT_MARKUP_BPS`, `REIMBURSEMENT_FAILURE_RESERVE_SATS`,
`REIMBURSEMENT_MINIMUM_SATS`, and `REIMBURSEMENT_MAXIMUM_SATS`. Optional
`SBTC_CONTRACT_ADDRESS` and `SBTC_CONTRACT_NAME` override the pinned testnet
contract for a test deployment.

Each record contains the requested economic-loop fields:

```json
{
  "sponsorship_id": "<sponsored Stacks txid>",
  "stacks_tx_id": "<sponsored Stacks txid>",
  "operator": "ST...",
  "fee_paid": "1234",
  "reimbursement_amount": "25",
  "reimbursement_tx_id": "<sBTC transfer txid>",
  "status": "confirmed"
}
```

Poll `GET /v1/reimbursements/<sponsorship-id>` for the current record. Status
progression is `pending_confirmation` → `payment_broadcast` → `confirmed`;
failed sponsorships and failed sBTC payments are terminal and never retried.
