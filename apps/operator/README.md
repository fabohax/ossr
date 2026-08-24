# OSSR operator

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
{ "status": "BROADCAST", "operator": "ST...", "transaction_id": "...", "fee_microstx": "..." }
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
contract for a test deployment. `CONFIRMATION_TIMEOUT_SECONDS` defaults to
`86400` and determines when an unresolved broadcast becomes
`CONFIRMATION_TIMEOUT`.

Each record contains the requested economic-loop fields:

```json
{
  "sponsorship_id": "<sponsored Stacks txid>",
  "stacks_tx_id": "<sponsored Stacks txid>",
  "operator": "ST...",
  "fee_paid": "1234",
  "reimbursement_amount": "25",
  "reimbursement_tx_id": "<sBTC transfer txid>",
  "status": "REIMBURSED"
}
```

Poll `GET /v1/reimbursements/<sponsorship-id>` for the current record. The
durable lifecycle is `REQUESTED → ACCEPTED → SPONSORED → BROADCAST → CONFIRMED
→ REIMBURSED`. A record created by the current relay begins at `BROADCAST`,
because its identifier is the signed transaction ID. `REJECTED`,
`OPERATOR_UNAVAILABLE`, `INSUFFICIENT_STX`, `BROADCAST_FAILED`,
`CONFIRMATION_TIMEOUT`, and `REIMBURSEMENT_FAILED` are terminal failure states.

## Day 9 operator registry

The MVP registry is a centralized JSON-backed discovery directory. Set
`OPERATOR_REGISTRY_PATH=.ossr/operators.json` when starting the relay to expose
these read-only endpoints:

```text
GET /v1/operators
GET /v1/operators/<operator-id>
```

Registry writers use the `OperatorRegistry` service in `src/registry.ts`. When
the relay has `OPERATOR_REGISTRY_PATH` configured, it also accepts this trusted
centralized health heartbeat:

```http
POST /operator/heartbeat
Content-Type: application/json

{
  "operator_id": "operator-001",
  "stx_balance_microstx": "42800000",
  "recent_successful_transactions": ["<64-character txid>"]
}
```

The response is the updated registry entry. Put this PoC endpoint behind
operator authentication before exposing it publicly.

```ts
import { JsonOperatorRegistryStore, OperatorRegistry } from './registry.js';

const registry = new OperatorRegistry(
  new JsonOperatorRegistryStore('.ossr/operators.json'),
);
await registry.register({
  operatorId: 'operator-001',
  publicKey: '0x02...', // compressed quote-verification public key
  endpoint: 'https://relay.example/v1',
  status: 'ONLINE',
  stxBalanceMicroStx: 42_800_000n,
  sbtcBalanceSats: 210_000n,
  feeBps: 10,
  supportedTransactionTypes: ['stx_transfer'],
  reimbursementAddress: 'ST...',
});
```

Discovery responses use JSON strings for `stx_balance_microstx` and optional
`sbtc_balance_sats`; those are integer base units and never floats. The
`OperatorRegistryReader` is the discovery migration seam: an on-chain adapter
can implement `list` and `get` while preserving the application-facing record
and endpoint response shape. `OperatorRegistryStore` remains the centralized
MVP persistence boundary. `last_seen` and `last_heartbeat` are off-chain ISO
timestamps; an on-chain adapter can derive their equivalent from a heartbeat
block height. The registry retains a bounded outcome history, recent successful
transaction IDs, and a rolling `failure_rate`. It marks an operator `UNHEALTHY`
when its heartbeat is stale, its STX balance is below
`OPERATOR_MINIMUM_BALANCE_MICROSTX`, or its failure rate exceeds
`OPERATOR_MAXIMUM_FAILURE_RATE` (default `0.5`). The heartbeat timeout defaults
to 60 seconds and is configured by `OPERATOR_HEARTBEAT_TIMEOUT_MS`.

For client-side A → B routing, `sponsorWithFailover` from `src/failover.ts`
tries healthy `ONLINE` registry entries in order. It retries only an explicit
`503 INSUFFICIENT_STX` response, avoiding duplicate requests after ambiguous
failures.
