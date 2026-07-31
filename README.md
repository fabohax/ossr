# Open Stacks Sponsor Relay (OSSR)

## Open token-based fee-abstraction infrastructure for Stacks

### One-line proposal

Open Stacks Sponsor Relay is an open-source, multi-operator network that lets users execute Stacks transactions without holding STX. Independent relayers pay the network fee in STX and receive reimbursement in a supported token. The first PoC uses sBTC; future adapters could support assets such as USDCx.

---

## 1. Executive summary

Stacks supports sponsored transactions in which the transaction originator authorizes an action while a separate sponsor account supplies the nonce, signature, and STX network fee. The origin signs first and the sponsor signs afterward. Although the user may experience the transaction as being paid in a supported token, the protocol-level fee remains denominated in microSTX.

Open Stacks Sponsor Relay turns this existing capability into shared public infrastructure.

Instead of every wallet and application operating a private STX sponsor, independent relay operators can run a standard daemon, advertise sponsorship policies, quote fees in a supported token, validate user-signed transactions, pay the required STX fee, and broadcast them to the Stacks network. The first PoC quotes sBTC fees in sats.

```text
User holds sBTC but no STX
          │
          ▼
Wallet requests sponsorship quotes
          │
          ▼
User signs the transaction payload
          │
          ▼
Selected relay validates and simulates it
          │
          ▼
Relay adds sponsor nonce, STX fee and signature
          │
          ▼
Stacks executes the transaction
          │
          ├── Recipient receives the requested sBTC
          └── Sponsor receives its fee in sats
```

The first sBTC-focused version would support explicitly integrated actions such as:

* Sending sBTC.
* Requesting an sBTC withdrawal.
* Paying a merchant in sBTC.
* Depositing into supported DeFi applications.
* Purchasing products or services through apps.
* Application-subsidized onboarding transactions.

The project would not change Stacks gas economics. STX remains the network fee asset; the relay provides a token-denominated abstraction above it. In the first PoC that token and its user-facing unit are sBTC and sats.

---

## 2. Problem

A user can hold sBTC on Stacks but still require STX before transferring, withdrawing, trading, or using that sBTC.

This creates several points of friction:

1. The user must discover where to obtain STX.
2. The user must acquire a second asset before using their Bitcoin.
3. Wallets must explain the relationship between BTC, sBTC and STX.
4. Small payments become impractical when onboarding costs exceed the payment itself.
5. Applications must maintain their own centralized sponsor infrastructure.
6. Each application develops incompatible sponsorship policies and APIs.

Stacks documentation now describes transaction-fee sponsorship as a way for users to pay transaction fees using sBTC rather than holding STX. Existing sBTC design work also concluded that sponsored transactions are the appropriate onboarding mechanism, while leaving a dynamic sponsorship market open for third-party implementation.

The missing component is an **open and reusable relay protocol** that is not permanently coupled to one reimbursement asset.

---

## 3. Proposed solution

Open Stacks Sponsor Relay consists of:

### Sponsor Relay Daemon

An open-source service operated by anyone willing to maintain an STX treasury and accept reimbursement in one or more supported tokens.

### Sponsor Adapter Contracts

Audited, token-specific Clarity contracts that combine a reimbursement payment with a supported application action.

### Relay Discovery

A standard mechanism through which wallets find available relay operators and their policies.

### Quote Protocol

A signed quote format defining the sponsor, reimbursement asset and amount, STX fee limit, supported action, and expiration.

### Wallet SDK

A TypeScript package that retrieves quotes, builds sponsored transactions, verifies relay responses and tracks settlement.

### Operator Dashboard

Infrastructure for monitoring sponsor balances, nonces, pending transactions, revenue, errors and supported contracts.

### Reimbursement Asset Adapters

Token-specific modules that define the reimbursement asset, base unit, pricing source, Clarity adapter, post-conditions, policy limits, and validation rules.

The relay protocol is asset-aware, but support is never assumed merely because a token implements SIP-010. Each asset must be explicitly integrated and allowlisted. The first implementation supports sBTC denominated in sats. A later USDCx integration would require its own reviewed adapter, precision and rounding rules, pricing source, policies, and tests.

---

## 4. Design principles

### Token-native user experience

A user with a supported token should be able to perform supported actions without first acquiring STX. The PoC proves this experience with sBTC.

### No user-fund custody

For atomic adapter transactions, the relay never takes custody of the user’s reimbursement tokens. Payment happens within the Stacks transaction.

### Open operation

Anyone can operate a relay using the same software and protocol.

### Wallet choice

Wallets can compare several relay quotes instead of depending on one provider.

### Explicit user limits

The user sees the sponsor fee in the selected token before signing and can use fungible-token post-conditions to limit the total amount that may leave their account. In the sBTC PoC, the fee is displayed in sats. Stacks transaction post-conditions support fungible-token transfer limits and abort execution when the resulting asset movements violate the user’s conditions.

### No consensus modification

The first version uses existing sponsored transaction functionality and Clarity contracts.

### Progressive decentralization

The project begins with independent HTTP relays and later adds relay registries, reputation and competitive routing.

---

## 5. Transaction model

Stacks sponsored authorization separates two roles:

* **Origin:** authorizes the application action.
* **Sponsor:** supplies the STX fee and sponsor nonce.

Both accounts sign the transaction. The user explicitly signs it as sponsor-enabled, after which the sponsor adds its own spending condition.

The Stacks authorization structure still records its fee in microSTX. Open Stacks Sponsor Relay therefore does not make sBTC, USDCx, or another reimbursement asset a native network gas token. It converts the user-facing obligation into the selected token while the relay handles STX settlement. The PoC quotes sBTC fees in sats.

### Example

```text
Requested transfer:     100,000 sats
Sponsor fee:                  32 sats
Maximum user spend:      100,032 sats

Stacks network fee:       paid by relay in STX
Relay reimbursement:      received in sBTC
```

---

## 6. Atomic adapter model

The most secure PoC uses fee-aware Clarity adapters.

A sponsored sBTC transfer adapter would conceptually perform:

```clarity
(define-public
  (sponsored-transfer
    (amount uint)
    (recipient principal)
    (sponsor-fee uint)
    (quote-id (buff 32))
    (expiry-height uint)
    (memo (optional (buff 34))))

  ;; Require an actual sponsor.
  ;; Require the quote to remain valid.
  ;; Transfer sponsor-fee from the user to tx-sponsor?.
  ;; Transfer amount from the user to recipient.
  ;; Emit quote-id and sponsorship information.
)
```

The `tx-sponsor?` Clarity keyword exposes the principal sponsoring the current transaction, allowing the contract to direct reimbursement to the actual STX fee payer rather than trusting a caller-provided recipient.

Stacks transactions are atomic, so both the sBTC reimbursement and application action either succeed together or revert together. An existing Stacks Core proposal demonstrates this wrapper pattern for an sBTC transfer and notes that it provides atomic fee payment, although it requires the target application or a proxy contract to support the pattern.

### Initial adapters

The first release should provide:

1. `sbtc-sponsored-transfer`
2. `sbtc-sponsored-withdrawal`
3. `sbtc-sponsored-payment`
4. `sbtc-sponsored-contract-adapter-trait`
5. Example integration for one external application

Every adapter should include:

* A maximum sponsor-fee parameter.
* Quote expiration.
* Sponsor verification through `tx-sponsor?`.
* A unique quote identifier.
* Structured `print` events.
* Clear sBTC post-condition templates.
* Mainnet and testnet configuration.
* Unit, integration and property tests.

---

## 7. User flow

### Step 1: Discover relays

The wallet obtains a list of relays from configured registries, application defaults or user-selected providers.

```http
GET /v1/relays
```

Each record includes:

```json
{
  "name": "Example Relay",
  "endpoint": "https://relay.example",
  "sponsorPrincipal": "SP...",
  "network": "mainnet",
  "supportedActions": [
    "sbtc-transfer",
    "sbtc-withdrawal"
  ],
  "policyHash": "0x..."
}
```

### Step 2: Request quotes

```http
POST /v1/quote
```

```json
{
  "network": "mainnet",
  "origin": "SPUSER...",
  "action": "sbtc-transfer",
  "call": {
    "contract": "SP...sbtc-sponsored-transfer",
    "function": "sponsored-transfer",
    "argumentsHash": "0x..."
  },
  "estimatedSize": 380,
  "maxSponsorFeeSats": 50
}
```

The relay responds with a signed offer:

```json
{
  "quoteId": "0x...",
  "relayId": "relay.example",
  "sponsorPrincipal": "SPSPONSOR...",
  "sponsorFeeSats": 32,
  "maxNetworkFeeMicroStx": "5000",
  "expiresAtBlock": 123456,
  "policyHash": "0x...",
  "signature": "0x..."
}
```

### Step 3: Build and sign

The wallet:

1. Verifies the relay quote signature.
2. Builds the adapter call with the quoted fee.
3. Marks the transaction as sponsored.
4. Adds an sBTC post-condition limiting the user’s total spend.
5. Signs the origin authorization.
6. Sends the signed transaction to the selected relay.

### Step 4: Validate and sponsor

```http
POST /v1/sponsor
```

```json
{
  "quoteId": "0x...",
  "originSignedTransaction": "0x..."
}
```

The relay checks:

* Origin signature.
* Network and chain ID.
* Origin nonce.
* Quote expiration.
* Exact contract and public function.
* Function arguments.
* Sponsor-fee amount.
* sBTC post-conditions.
* User balance.
* Transaction cost estimate.
* Relay policy.
* Duplicate or replayed quote IDs.
* Sponsor wallet liquidity.
* Current sponsor nonce.
* Simulation outcome.

The relay then adds its nonce, fee and sponsor signature.

### Step 5: Relay-controlled broadcast

The relay broadcasts the completed transaction itself and returns:

```json
{
  "txid": "0x...",
  "status": "broadcast",
  "sponsorPrincipal": "SPSPONSOR...",
  "sponsorFeeSats": 32
}
```

Relay-controlled broadcasting reduces opportunities for clients to hold or repeatedly resubmit completed sponsored transactions.

### Step 6: Settlement

When confirmed:

* The requested action executes.
* The sponsor receives its sBTC fee.
* The Stacks miner receives the STX network fee.
* The wallet reports one Bitcoin-denominated cost to the user.

---

## 8. Relay architecture

```text
┌──────────────────────────────────────────────────────┐
│                    Wallet SDK                        │
│ discovery · quotes · post-conditions · transaction   │
└──────────────────────────┬───────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────┐
│                 Sponsor Relay API                    │
│ authentication · limits · idempotency · quote cache  │
└─────────────┬───────────────┬──────────────┬─────────┘
              │               │              │
              ▼               ▼              ▼
      ┌──────────────┐ ┌─────────────┐ ┌──────────────┐
      │ Policy Engine│ │Tx Simulation│ │ Quote Engine │
      └──────────────┘ └─────────────┘ └──────────────┘
              │               │              │
              └───────────────┴──────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────┐
│              Sponsor Wallet Coordinator              │
│ wallet selection · nonce locking · fee bumping       │
└──────────────────────────┬───────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────┐
│ Stacks node / API · mempool · broadcaster · indexer  │
└──────────────────────────────────────────────────────┘
```

### Policy engine

Operators configure which transactions they accept:

```yaml
policies:
  - contract: SP...sbtc-sponsored-transfer
    function: sponsored-transfer
    maximum_sbtc_amount: 100000000
    maximum_sponsor_fee_sats: 500
    maximum_network_fee_microstx: 100000
    rate_limit_per_origin: 10/hour

  - contract: SP...sbtc-withdrawal
    function: initiate-withdrawal-request
    maximum_sponsor_fee_sats: 1000
```

### Sponsor wallet coordinator

The official sBTC sponsorship design proposed multiple sponsor addresses so the service can distribute pending transactions and avoid chaining-limit and nonce problems.

The coordinator should:

* Maintain several isolated hot wallets.
* Track confirmed and mempool nonces.
* Lock a wallet nonce before signing.
* Select the wallet with sufficient STX and the shortest pending chain.
* Detect missing or dropped nonces.
* Replace or cancel stuck transactions where supported.
* Keep treasury funds separate from signing wallets.

Stacks APIs expose confirmed, mempool, suggested-next and missing nonce information, which can support this coordinator.

### Key management

Production operators should support:

* HSM or remote signing.
* Encrypted keys at rest.
* Small hot-wallet balances.
* Treasury-to-hot-wallet limits.
* Emergency shutdown.
* Per-wallet daily fee limits.
* Audit logs without private user information.

---

## 9. Fee quotation

A relay converts its expected STX cost into sats:

```text
networkCostSats =
    estimatedFeeMicroSTX
    ÷ 1,000,000
    × satsPerSTX

sponsorFeeSats =
    networkCostSats
    + volatilityMargin
    + failureReserve
    + serviceFee
```

A quote should be valid only for a short block-height window.

The relay may offer several policy modes:

### Cost recovery

The user pays estimated network cost plus a small risk margin.

### Commercial relay

The operator adds a service margin.

### Application subsidy

A project reimburses the relay, while the user pays zero sats.

### Promotional allowance

A relay sponsors a limited number of transactions per address or application.

### Subscription credit

A wallet or application prepays the relay for a monthly transaction allowance.

No protocol token is necessary. Operators receive the configured reimbursement asset directly and spend STX directly. The first PoC reimburses operators in sBTC.

---

## 10. Why an allowlisted PoC

A generic relay that sponsors arbitrary contract calls is unsafe.

The relay could be asked to sign:

* Intentionally failing transactions.
* Extremely expensive transactions.
* Unsupported contracts.
* Calls with manipulated arguments.
* Transactions likely to abort after state changes.
* Repeated or conflicting nonce transactions.

Earlier sBTC design work therefore proposed validating the contract address and public function before sponsorship.

The Open Stacks Sponsor Relay PoC should use a public but permissioned-by-policy model:

```text
Open participation for relay operators
+
Explicit allowlists for sponsored actions
```

New applications can be added through reviewed policy manifests and adapter integrations.

---

## 11. Failed-transaction risk

Atomicity protects the user and guarantees that the sponsor is paid only when the intended state transition succeeds. However, it creates a risk for the sponsor.

When execution or a post-condition aborts, application state changes are reverted, but the network processing fee is still charged.

Therefore, a failed transaction may result in:

```text
Sponsor pays STX fee
User action reverts
sBTC reimbursement reverts
Sponsor receives nothing
```

The PoC mitigates this through:

* Full transaction simulation.
* Contract and function allowlists.
* Maximum execution-cost limits.
* Short quote expiration.
* Balance checks.
* Argument validation.
* State-sensitive policy rules.
* Per-origin rate limits.
* Failure reserves included in pricing.
* Restriction to deterministic or well-understood contracts.
* Temporary suspension of integrations showing elevated failure rates.

This risk cannot be eliminated completely with the atomic adapter model because blockchain state can change between simulation and execution.

---

## 12. Generic sponsorship

The initial proposal does not claim arbitrary contract-call support.

At present, atomic sBTC reimbursement generally requires the target application to include sponsorship logic or to be accessed through a wrapper. The open Stacks Core transaction-bundles proposal describes bundles as the cleaner mechanism for combining a sponsor payment and arbitrary application action without continuously deploying proxy contracts. As of July 2026, that proposal remains open.

Generic support can be explored through three later approaches:

### Standard adapter trait

Applications implement a common sponsored-action interface directly.

### Pre-funded fee vault

Users deposit sBTC into a non-custodial contract and issue narrowly scoped authorizations that relays can redeem. This requires separate design and security review, particularly around failed transactions, signatures and replay protection.

### Transaction bundles

If Stacks introduces atomic transaction bundles, one transaction could pay the sponsor in sBTC and another could execute any application action, with bundle-wide all-or-nothing settlement.

The PoC should not depend on bundles.

---

## 13. Open relay discovery

The first version can use signed JSON relay lists maintained by wallets and applications.

A later on-chain registry could contain:

* Relay principal.
* API endpoint hash.
* Supported network.
* Policy manifest hash.
* Operator bond.
* Availability state.
* Historical completion statistics.
* Dispute or incident flags.

The registry should not determine which relay a wallet must use. It should function as a discovery and reputation layer.

No DAO or governance token is required for initial deployment.

---

## 14. Threat model

### Malicious transaction payload

**Risk:** A client attempts to trick the relay into sponsoring another function or contract.

**Mitigation:** Deserialize the complete transaction and compare it against the signed quote and operator policy.

### Relay modifies the application action

**Risk:** A malicious relay changes the recipient, amount or contract.

**Mitigation:** The origin signature already authorizes the transaction payload. The sponsor appends its own authorization details rather than replacing the origin’s authorization.

### Excessive user token transfer

**Risk:** A defective adapter transfers more sBTC than expected.

**Mitigation:** Wallet-generated SIP-010 post-conditions limiting the total sBTC sent.

### Replayed quote

**Risk:** A quote or user-signed transaction is submitted repeatedly.

**Mitigation:** Unique quote IDs, block-height expiration, origin nonce tracking and replay caches.

### Cross-relay sponsorship race

**Risk:** The same origin transaction is presented to several relays.

**Mitigation:** Relays broadcast directly, use short-lived reservations, enforce per-origin nonce locks and share optional replay announcements. Binding an intent exclusively to one sponsor should be investigated as part of the protocol specification.

### Sponsor nonce exhaustion

**Risk:** Dropped or pending transactions block later sponsor transactions.

**Mitigation:** Multiple sponsor wallets, nonce coordination, missing-nonce detection and fee-bumping policies.

### Exchange-rate movement

**Risk:** STX appreciates between quotation and execution.

**Mitigation:** Short quote duration and volatility margin.

### Hot-wallet compromise

**Risk:** Sponsor STX is stolen.

**Mitigation:** Small wallet balances, treasury isolation, HSM support and automated limits.

### Denial of service

**Risk:** Attackers exhaust simulation or API resources.

**Mitigation:** Rate limits, quotas, request-size limits, optional API credentials and proof-of-work for subsidized endpoints.

### Privacy leakage

**Risk:** A relay correlates origin addresses, IP addresses and application actions.

**Mitigation:** Minimal logging, operator privacy policies, Tor-compatible endpoints and multiple relay choices.

---

## 15. Open-source deliverables

The project should publish:

```text
open-stacks-sponsor-relay/
├── apps/
│   ├── relay-server/
│   ├── operator-dashboard/
│   └── example-wallet/
├── contracts/
│   ├── sponsored-transfer.clar
│   ├── sponsored-withdrawal.clar
│   └── sponsor-adapter-trait.clar
├── packages/
│   ├── relay-sdk/
│   ├── quote-protocol/
│   ├── policy-engine/
│   └── transaction-validator/
├── specs/
│   ├── relay-api.md
│   ├── quote-format.md
│   ├── policy-manifest.md
│   └── threat-model.md
└── tests/
    ├── clarity/
    ├── integration/
    ├── adversarial/
    └── load/
```

Recommended implementation:

* Rust relay service.
* Stacks.js transaction construction.
* Clarity contracts with Clarinet tests.
* PostgreSQL for quote and transaction state.
* Redis or equivalent for nonce locks and idempotency.
* Prometheus-compatible metrics.
* Docker and reproducible deployment configuration.

---

## 16. Twelve-week PoC

### Milestone 1 — Protocol specification

**Deliverables**

* Relay API specification.
* Signed quote format.
* Policy manifest.
* Transaction-validation rules.
* Threat model.
* Sponsor-fee accounting model.

**Acceptance criteria**

* A wallet can independently verify a relay quote.
* Every quote is bound to a network, action, fee and expiration.
* Unsupported transaction types are clearly documented.

### Milestone 2 — Relay and sponsored transfer

**Deliverables**

* Relay daemon.
* Sponsor wallet coordinator.
* sBTC sponsored-transfer adapter.
* Fee estimation and quote service.
* Simulation and policy engine.
* Testnet deployment.

**Acceptance criteria**

* A user with sBTC and zero STX can send sBTC.
* The sponsor pays the STX network fee.
* The recipient receives the requested sats.
* The relay receives the quoted sats.
* User post-conditions prevent excess sBTC spending.
* Failed simulations are rejected before signing.

### Milestone 3 — Wallet SDK and withdrawal integration

**Deliverables**

* TypeScript wallet SDK.
* Sponsored-withdrawal integration.
* Quote comparison.
* Transaction status tracking.
* Example web interface.

**Acceptance criteria**

* A wallet can query at least two relay endpoints.
* The wallet can verify and select a quote.
* The user sees only a sat-denominated cost.
* Withdrawal and transfer flows work without user-held STX.

### Milestone 4 — Multi-operator pilot

**Deliverables**

* Two independently operated relays.
* Relay discovery manifest.
* Operator dashboard.
* Deployment documentation.
* Load and adversarial tests.
* Public testnet pilot report.

**Acceptance criteria**

* Wallet failover between operators works.
* Duplicate quote submissions are detected.
* Sponsor nonce gaps are detected and reported.
* Operator policies can be independently configured.
* All repositories and protocol documentation are public.

---

## 17. Success metrics

The pilot should measure:

* Sponsored transactions requested.
* Quote-to-broadcast conversion rate.
* Confirmation success rate.
* Median fee paid in sats.
* Difference between quoted and actual STX cost.
* Simulation rejection rate.
* On-chain failure rate.
* Sponsor revenue and loss from aborted transactions.
* Relay uptime.
* Sponsor nonce incidents.
* Number of integrated wallets and applications.
* Percentage of users completing transactions with zero STX balance.

The primary product metric is:

> A user holding only sBTC can successfully complete a supported Stacks action without learning about or acquiring STX.

---

## 18. Differentiation

Earlier official sBTC work described a centralized sponsoring server with allowlisted calls, multiple sponsor wallets, fee estimation and status endpoints. It intentionally left a dynamic fee market for later third-party development.

Open Stacks Sponsor Relay expands this into:

* A public protocol rather than one server.
* Multiple independent relay operators.
* Competitive sat-denominated quotes.
* Standardized wallet integration.
* Signed operator policy manifests.
* Open relay discovery.
* Reusable Clarity adapter standards.
* Transparent operator economics.
* Application-funded and user-funded sponsorship.
* A path toward generic sponsorship.

The project is therefore not another wallet and not an sBTC-only service. It is a shared transaction layer for wallets, merchants and Stacks applications, introduced through an sBTC-first PoC.

---

## 19. Long-term vision

The long-term objective is a permissionless sponsorship market across supported Stacks tokens:

```text
Wallet requests an sBTC-sponsored action
  │
  ├── Relay A: 24 sats
  ├── Relay B: 29 sats
  └── Relay C: free, subsidized by application
          │
          ▼
   Wallet selects policy
          │
          ▼
   Relay sponsors transaction
```

Independent operators compete on:

* Price.
* Reliability.
* Privacy.
* Confirmation policy.
* Supported contracts.
* Geographic availability.
* Application subsidies.
* Treasury capacity.
* Supported reimbursement assets.

Over time, sponsored transactions could become a default wallet primitive, allowing Stacks applications to present a Bitcoin-native experience while preserving STX as the underlying network fee asset.

---

## 20. Conclusion

Open Stacks Sponsor Relay makes the existing Stacks sponsorship mechanism accessible as public infrastructure.

It requires no consensus change for its first version. It preserves user authorization, allows operators to recover STX costs in a supported token, supports competition among sponsors and removes the requirement that token holders first obtain STX.

The proposed PoC focuses on the narrowest credible promise:

> Send, withdraw and use sBTC on Stacks while paying only in sats.

From that sBTC foundation, the project can develop into an open sponsorship market supporting wallets, merchants, applications, DeFi protocols, and additional assets such as USDCx.
