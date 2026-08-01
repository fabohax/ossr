# OSSR PoC Architecture

## Status

- **Project:** Open Stacks Sponsor Relay (OSSR)
- **Stage:** PoC proof of concept
- **Target environment:** Stacks testnet
- **Primary PoC use case:** Send sBTC without the user holding STX
- **Architecture status:** Proposed; this repository does not yet contain an implementation

## 1. Purpose

This document defines the smallest architecture that can prove the core OSSR claim:

> A user holding sBTC and no STX can sign an sBTC transfer, have an independent relay pay the Stacks network fee in STX, and reimburse that relay in sBTC as part of the same atomic transaction.

The proof of concept uses existing Stacks sponsored transactions and a dedicated sBTC Clarity adapter. It does not modify Stacks consensus or make sBTC a native gas token. OSSR itself is intended to support token-specific adapters and quote denominations beyond sBTC; assets such as USDCx are candidates for later integrations, not part of this PoC.

## 2. Scope

### In scope

- One Stacks network: testnet.
- One allowlisted action: `sbtc-sponsored-transfer`.
- One relay operator with one active sponsor account.
- A Rust relay HTTP service.
- A TypeScript client SDK and a minimal example client.
- A Clarity adapter that atomically transfers:
  - the requested sBTC amount to the recipient; and
  - the quoted sponsor fee in sBTC to `tx-sponsor?`.
- Signed, short-lived quotes.
- Origin-signed transaction validation.
- Transaction simulation, sponsor signing, and relay-controlled broadcast.
- Persistent quote and transaction state.
- Sponsor nonce serialization.
- Basic health, structured logs, and metrics.

### Out of scope for the PoC

- Mainnet deployment.
- Arbitrary contract calls.
- Sponsored withdrawals or DeFi actions.
- Reimbursement in tokens other than sBTC, including USDCx.
- On-chain relay discovery or reputation.
- Competitive routing across multiple relays.
- Multiple active sponsor wallets and automatic treasury management.
- HSM or remote signing.
- Fee bumping and automatic nonce-gap repair.
- A production operator dashboard.
- Cross-relay replay coordination.
- Batched payment intents, vault custody, and multi-user settlement (proposed for OSSR v0.2).

These are expected extensions after the core transaction path is demonstrated.

## 3. System context

```text
┌──────────────┐       quote + origin-signed tx       ┌──────────────────┐
│ Wallet / PoC │ ───────────────────────────────────▶ │ OSSR Relay       │
│ Client       │ ◀─────────────────────────────────── │                  │
└──────┬───────┘        quote + tx status             └───────┬──────────┘
       │                                                       │
       │ reads balances and status                             │ simulate,
       │                                                       │ sponsor,
       ▼                                                       │ broadcast
┌──────────────────────────────────────────────────────────────▼──────────┐
│                     Stacks testnet API / node                       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ executes
                                ▼
                  ┌──────────────────────────┐
                  │ Sponsored transfer      │
                  │ Clarity adapter + sBTC  │
                  └──────────────────────────┘
```

The client authorizes the application payload. The relay authorizes and pays the network fee. The adapter reimburses the actual transaction sponsor, not a sponsor address supplied by the client.

The relay protocol is asset-aware even though the PoC enables only sBTC. Token contract principals, units, precision, adapter contracts, fee conversion, post-condition construction, and policy limits are explicit configuration or protocol data rather than global assumptions.

## 4. Container architecture

```text
┌──────────────────────────────── Client ────────────────────────────────┐
│ Example UI / CLI                                                      │
│   └── OSSR SDK                                                        │
│       ├── request and verify quote                                    │
│       ├── build sponsored adapter call                                │
│       ├── add sBTC post-condition                                     │
│       ├── sign origin authorization                                   │
│       └── submit and poll status                                      │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ HTTPS / JSON
┌───────────────────────────────▼────────────────────────────────────────┐
│ Relay service                                                         │
│                                                                        │
│  HTTP API ─▶ Quote service ─▶ Policy and fee calculator               │
│      │                                                                 │
│      └────▶ Sponsorship pipeline                                      │
│              1. decode and validate transaction                        │
│              2. bind transaction to quote                              │
│              3. simulate                                               │
│              4. reserve sponsor nonce                                  │
│              5. add sponsor fee and signature                          │
│              6. broadcast                                              │
│              7. persist result                                         │
│                                                                        │
│  Sponsor signer       Repository       Stacks gateway                  │
└──────────┬─────────────────┬──────────────────┬─────────────────────────┘
           │                 │                  │
           │ local test key  │                  │ HTTP RPC/API
           ▼                 ▼                  ▼
      encrypted env/     PostgreSQL       Stacks testnet
      secret mount
```

### 4.1 Client SDK

The SDK owns user-side safety and transaction construction:

- Fetch relay metadata and public quote-verification key.
- Request a quote for an exact transfer intent.
- Verify the quote signature, relay identity, network, expiry, and fee limit.
- Construct the allowlisted adapter call.
- Mark the transaction as sponsored.
- Add a SIP-010 post-condition limiting total sBTC sent to:

  ```text
  transfer amount + sponsor fee
  ```

- Obtain the origin signature from the wallet.
- Submit only the origin-signed transaction.
- Return status in wallet-friendly terms.

The SDK never receives or stores the user's private key.

### 4.2 Relay HTTP API

The API is intentionally small:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/info` | Relay identity, network, sponsor principal, supported action, and quote public key |
| `POST` | `/v1/quotes` | Create a signed, expiring quote for a transfer intent |
| `POST` | `/v1/sponsorships` | Validate, sponsor, and broadcast an origin-signed transaction |
| `GET` | `/v1/sponsorships/{txid}` | Return relay and chain status |
| `GET` | `/health/live` | Process liveness |
| `GET` | `/health/ready` | Database, Stacks API, and sponsor readiness |
| `GET` | `/metrics` | Prometheus-compatible operational metrics |

The PoC may implement sponsorship synchronously, but the endpoint must be idempotent. Repeating the same request returns the stored result rather than creating a second sponsored transaction.

### 4.3 Quote service

A quote binds the relay's offer to one exact user intent. The signed payload contains:

```ts
type Quote = {
  version: "1";
  quoteId: string;                  // 32-byte random value
  relayId: string;
  network: "testnet";
  sponsorPrincipal: string;
  origin: string;
  action: "sbtc-transfer";
  reimbursementAsset: {
    assetId: "sbtc";
    contractPrincipal: string;
    unit: "sat";
    decimals: 8;
  };
  adapterContract: string;
  argumentsHash: string;            // canonical hash of adapter arguments
  sponsorFee: string;               // base units, decimal string; sats for PoC
  maxNetworkFeeMicroStx: string;
  issuedAtBlock: number;
  expiresAtBlock: number;
  keyId: string;
  signature: string;
};
```

The signature is computed over a domain-separated, canonical encoding of every field except `signature`. JSON object serialization is not used directly as signature input. Including the reimbursement asset prevents a quote for one token from being interpreted as a quote for another.

For the PoC, the fee calculator may use:

```text
sponsorFeeSats =
  estimated network cost in sats
  + configured failure reserve
  + configured service margin
```

The STX/sats conversion source and margins are operator configuration. A fixed testnet rate is acceptable for deterministic demonstrations and must be exposed in relay metadata or logs.

### 4.4 Asset adapter boundary

OSSR separates the common sponsorship pipeline from token-specific behavior:

```ts
interface ReimbursementAssetAdapter {
  assetId: string;
  contractPrincipal: string;
  baseUnit: string;
  decimals: number;
  buildSponsoredAction(intent: unknown, quote: Quote): Promise<Uint8Array>;
  validateSponsoredAction(transaction: Uint8Array, quote: Quote): Promise<void>;
  estimateReimbursement(networkFeeMicroStx: bigint): Promise<bigint>;
}
```

The PoC ships only an sBTC implementation. A future USDCx implementation would require its own reviewed Clarity adapter, pricing source, precision and rounding rules, post-condition templates, policies, and tests. Supporting a SIP-010 token at the type level does not make it safe automatically; each asset integration is explicitly enabled and allowlisted.

### 4.5 Transaction validator

The validator treats all client input as hostile. Before sponsor signing it verifies:

1. The quote exists, is unused, and has not expired.
2. The quote signature is valid.
3. The transaction is for the configured Stacks network and chain ID.
4. Sponsored authorization is enabled.
5. The origin signature is valid.
6. The transaction origin equals the quote origin.
7. The payload calls the exact configured adapter contract and function.
8. The canonical argument hash equals the quote's `argumentsHash`.
9. The adapter sponsor fee equals the quoted fee.
10. The expiry and quote ID arguments equal the quote.
11. The sBTC post-condition caps the origin's spend at the expected total.
12. The origin nonce is currently usable.
13. The estimated network fee is within the quote and operator limits.
14. The transaction simulation succeeds at the current chain tip.
15. Configured amount, rate, and execution-cost limits are satisfied.

Validation fails closed: unknown payload types, extra actions, ambiguous post-conditions, or decoding failures are rejected.

### 4.6 Sponsor coordinator and signer

The PoC uses one sponsor account and serializes all signing operations for it.

Within a database transaction, the coordinator:

1. Obtains a PostgreSQL advisory lock scoped to the sponsor principal.
2. Reconciles the locally recorded nonce with confirmed and mempool nonce data.
3. Reserves the next sponsor nonce.
4. Signs the validated transaction with the reserved nonce and selected STX fee.
5. Records the completed transaction bytes and transaction ID.
6. Broadcasts through the Stacks gateway.
7. Records the broadcast response.
8. Releases the lock.

Only one relay process should sign for the sponsor account in the PoC. Horizontal API scaling and multiple sponsor wallets require a more complete lease and reconciliation design.

The signer interface must hide key storage from the rest of the service:

```rust
trait SponsorSigner {
    async fn principal(&self) -> Result<StacksPrincipal, SignerError>;
    async fn sign_sponsored_transaction(
        &self,
        transaction: &OriginSignedTransaction,
        sponsor_nonce: u64,
        fee_microstx: u64,
    ) -> Result<SponsoredTransaction, SignerError>;
}
```

This allows a local test key to be replaced later by an HSM or remote signer.

### 4.7 Stacks gateway

All chain interaction is behind one interface:

- Current block height.
- Origin and sponsor nonce information.
- Account and sBTC balance queries.
- Fee and execution-cost estimation.
- Read-only or transaction simulation.
- Transaction broadcast.
- Mempool and confirmed transaction status.

The implementation should support configurable primary and fallback API endpoints, even if the PoC deploys with only one.

### 4.8 Clarity adapter

The first adapter exposes one public function conceptually equivalent to:

```clarity
(define-public
  (sponsored-transfer
    (amount uint)
    (recipient principal)
    (sponsor-fee uint)
    (quote-id (buff 32))
    (expiry-height uint)
    (memo (optional (buff 34))))
  ...)
```

Required invariants:

- `tx-sponsor?` must be present.
- The current block height must not exceed `expiry-height`.
- `amount` and `sponsor-fee` must be positive and within contract limits.
- The adapter transfers `sponsor-fee` from `tx-sender` to `tx-sponsor?`.
- The adapter transfers `amount` from `tx-sender` to `recipient`.
- Both transfers use the configured canonical sBTC contract.
- The call emits a structured event containing `quote-id`, origin, sponsor, recipient, amount, and fee.
- Any failed check or transfer reverts the entire contract call.

The adapter does not validate the off-chain quote signature. The origin signature, relay validation, adapter arguments, expiry, `tx-sponsor?`, and post-conditions collectively enforce the PoC transaction.

## 5. Core transaction sequence

```text
Client             Relay              Database          Stacks network
  │                  │                    │                    │
  │ POST /quotes     │                    │                    │
  ├─────────────────▶│ validate intent    │                    │
  │                  │ estimate fee ──────────────────────────▶│
  │                  │ create quote       │                    │
  │                  ├───────────────────▶│                    │
  │ signed quote     │                    │                    │
  │◀─────────────────┤                    │                    │
  │                  │                    │                    │
  │ build adapter call + post-condition   │                    │
  │ sign origin      │                    │                    │
  │                  │                    │                    │
  │ POST /sponsorships                    │                    │
  ├─────────────────▶│ load/reserve quote │                    │
  │                  ├───────────────────▶│                    │
  │                  │ validate + simulate────────────────────▶│
  │                  │ lock sponsor nonce │                    │
  │                  ├───────────────────▶│                    │
  │                  │ sponsor-sign       │                    │
  │                  │ broadcast ─────────────────────────────▶│
  │                  │ store txid/status  │                    │
  │                  ├───────────────────▶│                    │
  │ txid             │                    │                    │
  │◀─────────────────┤                    │                    │
  │                  │                    │                    │
  │ GET status       │ poll/index status  │                    │
  ├─────────────────▶│────────────────────────────────────────▶│
  │ confirmed/failed │                    │                    │
  │◀─────────────────┤                    │                    │
```

There is an unavoidable race between simulation and block execution. A state change can still make a simulated transaction fail, leaving the sponsor to pay STX without receiving sBTC. The allowlist, short expiry, limits, and failure reserve reduce this risk but cannot remove it.

## 6. State model

### Quote states

```text
ISSUED ──▶ RESERVED ──▶ CONSUMED
   │           │
   ├──────────▶EXPIRED
   └──────────▶REJECTED
```

- `ISSUED`: Signed and available for one submission.
- `RESERVED`: A sponsorship request is being processed.
- `CONSUMED`: Sponsor signing has produced a transaction.
- `EXPIRED`: The current block is beyond the quote expiry.
- `REJECTED`: Validation or simulation permanently rejected the submission.

A transient Stacks API failure should release a reservation back to `ISSUED` when safe. Once sponsor-signed bytes exist, the quote is `CONSUMED` even if broadcast returns an ambiguous result; the relay must retry or query by transaction ID, never sign a replacement blindly.

### Sponsorship states

```text
VALIDATING → SIGNED → BROADCAST → MEMPOOL → CONFIRMED
     │          │          │          └────→ DROPPED
     └──────────┴──────────┴───────────────→ FAILED
```

## 7. Persistence

PostgreSQL is the only required stateful service for the PoC. Redis is intentionally omitted.

Minimum tables:

| Table | Important fields |
|---|---|
| `quotes` | quote ID, canonical payload, signature, origin, arguments hash, fee, expiry, state, timestamps |
| `sponsorships` | quote ID, request hash, origin-signed bytes, sponsored bytes, txid, sponsor nonce, network fee, state, error code |
| `sponsor_accounts` | principal, last reconciled nonce, enabled flag, updated timestamp |
| `chain_events` | txid, observed state, block height, raw status, observed timestamp |

Constraints:

- `quotes.quote_id` is unique.
- At most one sponsorship exists per quote.
- `sponsorships.request_hash` is unique for idempotency.
- Sponsor principal plus sponsor nonce is unique.
- Binary transactions may be retained for the PoC but must never contain private keys.

## 8. Trust boundaries and security

### Assets to protect

- Sponsor private key and STX balance.
- Sponsor nonce sequence.
- Quote-signing key.
- Relay availability and simulation capacity.
- Correct binding between quote, transaction, and adapter call.
- User privacy in logs and stored request data.

### Trust boundaries

| Boundary | Assumption |
|---|---|
| Client → relay | Completely untrusted input |
| Relay → Stacks API | Responses may be stale, unavailable, or inconsistent |
| Relay → database | Authenticated private network connection |
| Relay → signer | Narrow interface; raw key is inaccessible outside signer implementation |
| Adapter → sBTC contract | Only a pinned, configured contract principal is trusted |

### PoC controls

- Maximum body size and strict schema validation.
- Per-IP and per-origin rate limits.
- Canonical transaction deserialization; no validation based only on client-provided JSON.
- Domain-separated quote signatures and key IDs for rotation.
- Short block-height quote expiry.
- Database-backed idempotency and one-time quote use.
- Sponsor nonce locking.
- Contract/function allowlist.
- Simulation before every signature.
- Maximum STX fee, sBTC amount, execution cost, and daily sponsor spend.
- Redaction of transaction bytes, IP addresses, keys, and authorization headers from logs.
- Startup refusal when network, sponsor principal, adapter, or sBTC contract configuration is inconsistent.
- Emergency switch that disables new quotes and signing while preserving status endpoints.

### Key separation

Quote signing and sponsor transaction signing use different keys. Compromise of the quote key must not directly authorize spending from the sponsor STX account.

For a public demo, secrets are injected at runtime and never committed. Mainnet requires remote signing or an HSM, audited operational controls, and small isolated hot-wallet balances.

## 9. Deployment

The reference PoC deployment uses Docker Compose:

```text
┌──────────────── host / private network ────────────────┐
│ reverse proxy (TLS, request limits)                    │
│     │                                                  │
│ relay-server ───────── PostgreSQL                      │
│     │                                                  │
│ status worker (may run in relay process for PoC)       │
└─────┼──────────────────────────────────────────────────┘
      │ outbound HTTPS
      ▼
Stacks testnet API
```

Required configuration includes:

- Stacks network and chain ID.
- Primary and fallback Stacks API URLs.
- Adapter and canonical sBTC contract principals.
- Sponsor signer configuration.
- Quote signer configuration.
- Quote lifetime in blocks.
- Maximum transfer, sponsor fee, network fee, and execution cost.
- Fee conversion rate and margins.
- Database URL.
- Rate limits and emergency-disable flag.

The service should expose its build commit and configuration hashes through `/v1/info`, excluding secrets.

## 10. Observability

Structured logs carry a request ID, quote ID, and transaction ID where available. They do not log private keys, raw authorization headers, or full signed transaction bytes.

Minimum metrics:

- Quotes issued, expired, rejected, and consumed.
- Sponsorship requests by outcome.
- Validation and simulation rejection reason.
- Quote-to-broadcast latency.
- Broadcast-to-confirmation latency.
- Confirmed, aborted, and dropped transactions.
- STX fees paid and sBTC fees received.
- Estimated versus actual network fee.
- Sponsor STX balance and next nonce.
- Stacks API error rate and latency.

Alerts for the testnet pilot should cover low sponsor balance, nonce mismatch, elevated simulation failures, elevated on-chain failures, database unavailability, and signing being disabled.

## 11. Proposed repository layout

```text
ossr/
├── crates/
│   ├── relay-server/          # Rust HTTP API and sponsorship pipeline
│   ├── protocol/              # Quote encoding and shared Rust domain types
│   ├── transaction-validator/ # Fail-closed sponsored transaction checks
│   └── stacks-gateway/        # Chain API abstraction
├── packages/
│   ├── client-sdk/            # TypeScript wallet-facing helpers
│   └── demo-cli/              # Minimal wallet-like PoC
├── contracts/
│   ├── sponsored-transfer.clar
│   └── tests/
├── fixtures/                  # Cross-language JSON and binary golden vectors
├── migrations/                # PostgreSQL schema
├── deploy/
│   └── compose.yaml
├── adr/
├── tests/
│   ├── integration/
│   └── adversarial/
├── ARCHITECTURE.md
└── README.md
```

The Rust relay and TypeScript client share language-neutral protocol fixtures,
JSON schemas, and binary golden vectors rather than source types. This keeps
runtime secrets and operator policy out of the client while verifying that both
implementations encode the same protocol bytes.

## 12. Verification strategy

### Contract tests

- Successful amount and fee transfers.
- Missing sponsor rejection.
- Expired quote rejection.
- Insufficient balance and failed transfer rollback.
- Sponsor is always `tx-sponsor?`.
- Event contents.
- Post-condition compatibility.

### Protocol tests

- Stable canonical encoding and signature test vectors.
- Signature failure after any field changes.
- Large integer round trips without JavaScript number conversion.
- Network and domain separation.

### Relay tests

- Every validator rule has an accept and reject case.
- Duplicate requests return the original result.
- Concurrent requests cannot reuse a quote or sponsor nonce.
- Ambiguous broadcast responses do not cause re-signing.
- Stale or inconsistent chain responses fail safely.
- Secrets and raw transactions are redacted.

### End-to-end acceptance test

On Stacks testnet:

1. Fund the user with sBTC and leave the user with zero STX.
2. Fund the relay sponsor with STX.
3. Request and verify a quote.
4. Build and origin-sign the sponsored adapter call.
5. Submit it to the relay.
6. Confirm the relay sponsors and broadcasts it.
7. Confirm the recipient receives the requested sBTC.
8. Confirm the sponsor receives the quoted sBTC fee.
9. Confirm the sponsor, not the user, pays the STX network fee.
10. Confirm a modified, expired, replayed, or over-limit transaction is rejected.

The PoC is successful only when this test is reproducible from documented setup commands.

## 13. Evolution after the PoC

The next architectural increments are:

1. Add sponsored withdrawal as a second reviewed adapter.
2. Split status indexing into a worker and add robust retry queues.
3. Add multiple sponsor accounts with wallet selection and nonce-gap recovery.
4. Add signed discovery manifests and quote comparison across independent relays.
5. Add remote signing, treasury automation, and production deployment hardening.
6. Add an operator dashboard from the existing API and metrics.
7. Evaluate a standard adapter trait, fee vaults, or transaction bundles for broader application support.

Each increment should preserve the PoC's central safety rule: the relay signs only a completely decoded, simulated, policy-approved transaction that is cryptographically bound to an unexpired quote.

## 14. Architecture decisions

| Decision | Rationale |
|---|---|
| Use an atomic Clarity adapter | Proves sBTC reimbursement without custody or a consensus change |
| Allowlist one action | Keeps transaction validation auditable and limits failed-fee exposure |
| Relay broadcasts signed transactions | Reduces withholding and repeated-submission risk |
| Use block height for expiry | Matches chain execution and avoids clock disagreement |
| Use PostgreSQL for state and locks | One durable dependency is sufficient for PoC idempotency and nonce serialization |
| Separate quote and sponsor keys | Limits the impact of a quote-key compromise |
| Hide signing behind an interface | Preserves a path from a test key to remote or hardware signing |
| Exclude Redis and microservices | They do not help prove the core transaction path |
| Start with one operator | Multi-operator routing is valuable only after sponsorship works end to end |
| Use Rust for the relay | Strong domain types and concurrency safety suit a security-sensitive signer; a compatibility spike limits Stacks-library risk |
| Keep the client SDK in TypeScript | Preserves compatibility with wallet-facing Stacks tooling |
| Require PostgreSQL from the start | Durable constraints and transaction-scoped locks enforce quote and sponsor-nonce invariants |

Detailed rationale and consequences are recorded in
[ADR 0001](adr/0001-use-rust-for-the-relay.md) and
[ADR 0002](adr/0002-use-postgresql-for-durable-state.md).
