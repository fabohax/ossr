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
