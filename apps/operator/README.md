# OSSR operator

The testnet-only `OssrOperator` component owns one sponsor wallet. It checks its
STX balance, serializes sponsor nonce allocation, adds sponsor authorization,
broadcasts fully signed transactions, retrieves transaction status, and writes
structured JSON logs. The relay API validates application policy before asking
the operator to sign and broadcast.

The CLI reads `.env.local` first and then `.env`, both from the repository root.
Copy the example and keep the populated file private:

```sh
cp .env.example .env.local
chmod 600 .env.local
```

Configure `SPONSOR_PRIVATE_KEY`, `STACKS_API_URL`, and optionally
`OPERATOR_MINIMUM_BALANCE_MICROSTX`, then run:

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
type is sponsored. Nonce allocation is serialized and persisted to
`.ossr/nonces.json` by default (`NONCE_STORE_PATH` overrides it). The next nonce
is the greater of the chain nonce and every durable reservation plus one.

For the relay path, a successfully simulated transaction is recorded before
broadcast. Successful submission becomes `BROADCAST`; a transport error becomes
`AMBIGUOUS`; later reconciliation records `CONFIRMED`, `FAILED`, or the latest
chain status. The operator never automatically releases a durable nonce because
a missing transaction can still reflect propagation or indexer uncertainty.

```sh
npm run operator:nonce-status
npm run operator:nonce-reconcile
```

## Run the local relay API

Run commands below from the repository root. Install dependencies first with
`npm install`. A real sponsorship also requires the authenticated Stacks Core
follower configured by `STACKS_SIMULATION_API_URL` and
`STACKS_SIMULATION_AUTH_TOKEN`; its tip must match the public Stacks API tip.

Start the local HTTP relay with:

```sh
npm run operator:serve
```

It listens on `127.0.0.1:3002` by default (`OPERATOR_HOST` and
`OPERATOR_PORT` override this). When testing the web UI from a LAN origin such
as `http://192.168.18.82:3000`, set `OPERATOR_HOST=0.0.0.0` and include that
origin in `OSSR_CORS_ALLOWED_ORIGINS`. After startup, verify readiness:

```sh
curl -fsS http://127.0.0.1:3002/health/live
curl -fsS http://127.0.0.1:3002/health/ready
curl -fsS http://127.0.0.1:3002/v1/info
```

`/health/ready` checks the sponsor's indexed STX balance and can temporarily
return `503 OPERATOR_UNAVAILABLE` if the configured public API rate-limits the
request. `503 SIMULATION_STALE` means the local simulation follower is behind;
restart or resynchronize that follower rather than restarting this relay.

The interface-facing v1 endpoints are:

```text
GET /v1/info
GET /v1/metrics
POST /v1/quotes
POST /v1/sponsorships
GET /v1/sponsorships/0x<txid>
```

`GET /v1/metrics` returns a compact, process-lifetime snapshot containing
operator readiness and STX balance, request counts, rejected sponsorships,
successful broadcasts, observed confirmations, cumulative STX network fees,
and confirmed sBTC reimbursements. It also reports count, total, average, last,
and maximum milliseconds for quote generation, submission-to-broadcast, and
broadcast-to-confirmation latency. Confirmations and the quote's sponsor fee are
counted once when the status endpoint observes `success`; replays do not inflate
broadcast totals.
Counters reset when the relay process restarts and contain no wallet secrets.

`POST /v1/sponsor` remains only as a compatibility alias and, like
`POST /v1/sponsorships`, requires a relay-issued `quoteId`. Unquoted
sponsorship is disabled.

Set `QUOTE_PRIVATE_KEY` to enable `POST /v1/quotes`. This key signs quotes
only; it should be distinct from `SPONSOR_PRIVATE_KEY`.

Set `STACKS_SIMULATION_API_URL` to a Stacks Core 4.0.3+ RPC endpoint and
`STACKS_SIMULATION_AUTH_TOKEN` to its `connection_options.auth_token`. Before
broadcasting, the relay submits the fully signed transaction to
`POST /v3/transactions/simulate` and requires the matching txid, no VM error,
no post-condition abort, an `(ok true)` result, complete tip and execution
metadata, and an ephemeral block height at least one greater than the chain tip
observed immediately before simulation. Unavailable, ambiguous, stale,
malformed, or failed responses are rejected without broadcasting or advancing
the operator's in-process sponsor nonce.

Quotes and sponsorship outcomes are persisted to `.ossr/quotes.json` by
default (`QUOTE_STORE_PATH` overrides it). The quote ID is the idempotency key:
the first request atomically reserves it, an exact retry after broadcast gets
the stored response, different transaction bytes are rejected, and a restart
will not automatically retry a quote left in `PROCESSING` after an ambiguous
broadcast. That state requires operator reconciliation.

The sponsorship body is:

```json
{ "quoteId": "0x...", "transaction": "0x...", "user": "ST..." }
```

The relay validates the encoded testnet transaction, sponsored authorization,
origin signature, claimed origin address, and configured sBTC adapter target;
estimates its STX fee; verifies operator health and balance; then signs and
broadcasts it. A successful response is:

```json
{ "status": "BROADCAST", "operator": "ST...", "transaction_id": "...", "fee_microstx": "..." }
```

## Day 5 end-to-end CLI

With the relay running and quote signing enabled, submit an origin-signed sBTC
adapter transaction through the full CLI → relay → operator → testnet flow:

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

The prototype creates exactly one payout transaction: the sponsor/operator
reimbursement. It does not create or persist a separate protocol-fee payment.

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

This local registry does not collect or claim to verify payments. The funded
registry design may require an operator-funded listing fee before activation;
that fee supports protocol maintenance and remains completely separate from
user transactions and sponsor reimbursements.

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
