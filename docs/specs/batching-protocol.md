# OSSR Batching Protocol

## Technical Specification v0.2

**Status:** Experimental draft; implementation and testing follow OSSR v0.1
**Network:** Stacks
**Settlement asset:** sBTC
**Fee asset paid by operators:** STX
**User authorization:** SIP-018 signed structured data
**Initial maximum batch size:** 50 intents
**Protocol maximum target:** 200 transfers, subject to execution-cost testing

### Release relationship

OSSR v0.1 covers individual sponsorship: one user signs one sponsor-enabled Stacks transaction, and one relay validates, sponsors, and broadcasts it. That flow is the required baseline and does not depend on a vault or off-chain payment intents.

This document defines the proposed OSSR v0.2 extension. Batching must not be treated as part of the v0.1 PoC, and its limits or savings must not be presented as established until the v0.2 test plan has been completed against the single-transaction baseline.

---

## 1. Abstract

OSSR Batching allows multiple independent users to authorize sBTC payments off-chain and have those payments settled together in one Stacks transaction.

Users maintain sBTC balances inside an OSSR smart-contract vault. Instead of signing and broadcasting one Stacks transaction for every payment, each user signs a SIP-018 payment intent. An OSSR operator collects compatible intents, creates a batch, pays the Stacks transaction fee in STX and calls the OSSR vault contract.

The vault verifies every intent, deducts the corresponding internal balances and executes the recipient payments from its pooled sBTC balance.

This model produces:

* One Stacks transaction for many user payments.
* One fee-paying operator nonce per batch.
* Shared network costs.
* Fees paid by users in sBTC.
* Operator revenue from every intent.
* Protocol revenue from every intent.
* Reduced mempool and sponsor-account pressure.

Batch mode is separate from OSSR’s individual sponsored-transaction mode. In batch mode, users sign messages rather than complete Stacks transactions.

---

## 2. Protocol basis

The current sBTC token contract exposes `transfer-many`, accepting a list of up to 200 transfer entries. Its transfer authorization requires either `tx-sender` or `contract-caller` to equal the specified sender.

Because one OSSR operator cannot directly move sBTC belonging to multiple unrelated account principals, OSSR batching uses a vault that owns the pooled sBTC. Users retain claims over that pooled balance through the vault’s internal accounting.

SIP-018 explicitly supports off-chain messages that authorize future smart-contract actions and off-chain mechanisms later settled on-chain. It provides application and chain domain separation, but application-level replay protection must be implemented by OSSR.

Stacks transaction fees depend on transaction size, estimated execution cost and market fee rates. Operators must estimate candidate batch transactions through `POST /v2/fees/transaction` before issuing or accepting final quotes.

---

## 3. Architecture

### 3.1 OSSR Vault

A Clarity smart contract that:

* Holds pooled sBTC.
* Tracks each user’s internal balance.
* Verifies signed payment intents.
* Tracks user nonces.
* Deducts payment amounts and fees.
* Executes recipient transfers.
* Accrues operator earnings.
* Accrues OSSR protocol earnings.
* Emits settlement events.
* Supports deposits and withdrawals.

The vault must not give operators arbitrary control over user balances. An operator may only execute an intent whose amount, recipient, fees, nonce, expiration and operator authorization are covered by the user’s signature.

### 3.2 User wallet or OSSR SDK

The client:

1. Reads the user’s vault balance and nonce.
2. Requests an operator quote.
3. Constructs a SIP-018 intent.
4. Displays the payment and exact fees.
5. Requests the user’s signature.
6. Sends the intent and signature to the operator.
7. Tracks settlement status.

### 3.3 Operator

An operator:

* Maintains STX for transaction fees.
* Maintains a Stacks account and nonce manager.
* Publishes fee quotes.
* Receives user intents.
* Performs off-chain validation.
* Groups compatible intents.
* Simulates candidate batches.
* Estimates transaction fees.
* Broadcasts the settlement transaction.
* Monitors confirmation.
* Accrues reimbursement and margin in sBTC.

### 3.4 OSSR protocol service

The protocol service may provide:

* Operator discovery.
* Reputation data.
* Quote comparison.
* Batch indexing.
* Intent-status APIs.
* Fee statistics.
* Operator availability.
* Protocol configuration.

This service must not be required to validate an on-chain settlement. The vault contract remains the source of truth.

### 3.5 Indexer

An indexer reads contract events and exposes:

* Pending intent status.
* Batch status.
* Settlement transaction ID.
* Payment result.
* Charged fees.
* Operator performance.
* Historical batch savings.

---

## 4. Vault accounting

The contract maintains the following conceptual state:

```clarity
balances:
    principal -> uint

nonces:
    principal -> uint

operator-earnings:
    principal -> uint

protocol-earnings:
    uint

registered-operators:
    principal -> {
        active: bool,
        fee-recipient: principal
    }

processed-batches:
    batch-id -> bool

paused:
    bool
```

The accounting invariant is:

```text
vault sBTC balance
=
sum(user balances)
+ sum(operator earnings)
+ protocol earnings
```

A settlement decreases user liabilities, transfers payment amounts to recipients and converts the fee portion into operator and protocol liabilities.

Example:

```text
User internal balance before:     10,000 sats
Payment:                           1,000 sats
Network-cost share:                   8 sats
Operator margin:                      4 sats
Protocol fee:                         2 sats

User internal balance after:       8,986 sats
Recipient receives:                1,000 sats
Operator earnings increase:           12 sats
Protocol earnings increase:            2 sats
```

Operator and protocol fees remain inside the vault until claimed. This avoids adding separate operator and protocol sBTC transfers to every batch.

---

## 5. Deposits and withdrawals

### 5.1 Deposit

A user calls:

```clarity
(deposit
    amount: uint)
```

The function:

1. Transfers `amount` sBTC from the user to the vault.
2. Increases `balances[user]` by `amount`.
3. Emits a deposit event.

Depositing is an individual on-chain action. Its cost can be amortized over many later batched payments.

### 5.2 Withdrawal

A user calls:

```clarity
(withdraw
    amount: uint
    recipient: principal)
```

The function:

1. Verifies sufficient available balance.
2. Decreases the internal balance.
3. Increments the user’s OSSR nonce.
4. Transfers sBTC to the requested recipient.
5. Emits a withdrawal event.

Incrementing the nonce invalidates previously signed intents that have not yet settled.

### 5.3 Withdrawal race

A user may withdraw after submitting an intent but before its settlement. This can invalidate an entire atomic batch.

The MVP mitigates this through:

* Short intent expiration.
* Immediate pre-broadcast simulation.
* Minimum balance buffers.
* Temporary suspension of an intent when conflicting activity is detected.
* Rebuilding the batch when an intent becomes invalid.

A later protocol version may introduce operator-specific locked balances or payment-channel-style allowances.

---

## 6. Payment intent

Each user signs a SIP-018 structured message.

### 6.1 Domain

```clarity
{
    name: "OSSR Batch",
    version: "1",
    chain-id: chain-id,
    verifying-contract: ossr-vault-principal
}
```

The verifying contract should be included in the domain so that a signature intended for one vault cannot be submitted to another vault.

### 6.2 Intent structure

```clarity
{
    intent-version: uint,
    sender: principal,
    recipient: principal,
    amount: uint,

    network-share: uint,
    operator-margin: uint,
    protocol-fee: uint,

    operator: principal,
    nonce: uint,
    quote-id: (buff 32),
    expires-at: uint
}
```

### 6.3 Signed fields

#### `sender`

The vault account whose internal balance will be debited.

#### `recipient`

The principal receiving the sBTC payment.

#### `amount`

The exact payment amount in sats.

#### `network-share`

The user’s quoted contribution toward the operator’s STX transaction cost, denominated in sats.

#### `operator-margin`

The operator’s service revenue.

#### `protocol-fee`

The OSSR protocol charge.

#### `operator`

The only operator authorized to settle the intent.

Pinning an intent to an operator prevents another operator from taking the quote and charging the user without providing the intended service.

#### `nonce`

The next expected OSSR nonce for the sender.

#### `quote-id`

A unique identifier linking the intent to the operator’s signed quote.

#### `expires-at`

The final Stacks block height or timestamp at which the intent remains valid.

---

## 7. Quote protocol

An operator returns a quote before the user signs an intent.

```json
{
  "quote_id": "32-byte identifier",
  "operator": "SP...",
  "network_share_sats": 8,
  "operator_margin_sats": 4,
  "protocol_fee_sats": 2,
  "total_fee_sats": 14,
  "target_batch_size": 25,
  "minimum_batch_size": 10,
  "expires_at": 123456,
  "estimated_settlement_blocks": 2
}
```

The operator signs the quote response.

The user’s intent reproduces the exact fee fields and `quote_id`. Therefore:

* The operator cannot increase the fee.
* The user cannot alter the quote.
* Another operator cannot claim the intent.
* The quote can expire.
* The contract can enforce the signed totals.

The quote is not charged unless the intent settles successfully.

---

## 8. Fee calculation

For a candidate batch containing `N` intents:

```text
estimated_network_cost_stx
    = estimate(candidate settlement transaction)

estimated_network_cost_sats
    = estimated_network_cost_stx
      × STX/BTC conversion rate

protected_network_cost_sats
    = estimated_network_cost_sats
      × risk buffer
```

For equal-sized intents:

```text
network_share_i
    = ceil(protected_network_cost_sats / N)
```

The total user fee is:

```text
total_fee_i
    = network_share_i
    + operator_margin_i
    + protocol_fee_i
```

The operator’s earnings are:

```text
operator_gross_batch
    = sum(network_share_i + operator_margin_i)
```

The operator’s net result is:

```text
operator_net_batch
    = operator_gross_batch
    - actual Stacks fee converted to sats
    - infrastructure costs
```

OSSR protocol revenue is:

```text
protocol_revenue_batch
    = sum(protocol_fee_i)
```

A batch must not be broadcast unless:

```text
operator_gross_batch
>
estimated network cost
+ minimum operator profit threshold
```

### 8.1 Exchange-rate protection

The quote engine should use:

* A recent STX/BTC rate.
* A maximum oracle age.
* A configurable volatility buffer.
* A short quote lifetime.
* A minimum network-cost share.

The vault does not need to trust an oracle because the user signs the exact satoshi fees. The oracle is part of the operator’s quoting and profitability logic, not the authorization logic.

---

## 9. Batch construction

Only compatible intents may enter the same batch.

Compatibility requires:

* Same Stacks network.
* Same OSSR vault version.
* Same sBTC token contract.
* Registered and active operator.
* Unexpired quote.
* Unexpired intent.
* Correct user nonce.
* Sufficient user balance.
* Valid SIP-018 signature.
* Batch size within contract limits.

### 9.1 Selection algorithm

The recommended selection order is:

1. Earliest expiration.
2. Highest effective operator margin.
3. Oldest accepted intent.
4. Smallest serialized intent size.

Operators should maintain separate queues for:

* Standard batches.
* Priority batches.
* Different vault versions.
* Different network environments.

### 9.2 MVP batch limits

```text
Minimum preferred batch:    10 intents
Target batch:                25 intents
Maximum MVP batch:           50 intents
Underlying future target:   200 transfers
```

Although the current sBTC repository contract accepts as many as 200 `transfer-many` entries, the OSSR contract should initially use a smaller compile-time list limit. Signature verification, balance writes and event generation add execution cost beyond the underlying token transfers.

The final limit must be determined from Clarinet cost reports and transaction simulation rather than from the sBTC list limit alone. Clarinet supports static checking, runtime-cost analysis and test cost reports.

---

## 10. Settlement transaction

The operator calls:

```clarity
(settle-batch
    batch-id: (buff 32)
    entries: (list 50 {
        sender: principal,
        recipient: principal,
        amount: uint,
        network-share: uint,
        operator-margin: uint,
        protocol-fee: uint,
        operator: principal,
        nonce: uint,
        quote-id: (buff 32),
        expires-at: uint,
        signature: (buff 65)
    }))
```

### 10.1 Contract validation

For every entry, the vault verifies:

```text
protocol is not paused
operator is registered
tx-sender equals signed operator
batch-id has not been processed
intent has not expired
nonce equals stored user nonce
user balance covers amount plus fees
protocol fee matches protocol rules
signature resolves to sender principal
amount is greater than zero
recipient is valid
```

SIP-018 domain separation protects against cross-chain and cross-application replay, while the OSSR nonce, expiration, quote ID and processed-batch checks provide application-level replay protection. SIP-018 itself leaves application-level replay handling to the application.

### 10.2 State transition

For each valid intent:

```text
balances[sender]
    -= amount
     + network-share
     + operator-margin
     + protocol-fee

nonces[sender] += 1

operator-earnings[operator]
    += network-share
     + operator-margin

protocol-earnings
    += protocol-fee
```

After updating accounting, the vault calls the sBTC token’s `transfer-many` function with one entry per recipient:

```clarity
{
    amount: payment-amount,
    sender: ossr-vault-principal,
    to: recipient,
    memo: none
}
```

Because the OSSR vault is the calling contract and owns the pooled sBTC, it satisfies the sBTC transfer authorization requirement. This is the central reason for using a pre-funded vault.

### 10.3 Atomicity

Version 0.2 uses atomic batches:

* Every intent succeeds, or
* The entire settlement transaction aborts.

The current sBTC `transfer-many` implementation propagates an error when an individual transfer fails. Stacks’ documented send-many pattern similarly uses all-or-nothing batch execution.

Atomicity simplifies accounting and prevents a user from being charged when their recipient payment fails.

---

## 11. Events

A successful batch emits:

```clarity
{
    topic: "batch-settled",
    batch-id: batch-id,
    operator: tx-sender,
    intent-count: uint,
    total-payment: uint,
    total-network-share: uint,
    total-operator-margin: uint,
    total-protocol-fee: uint
}
```

Each intent also emits:

```clarity
{
    topic: "intent-settled",
    batch-id: batch-id,
    sender: principal,
    recipient: principal,
    amount: uint,
    total-fee: uint,
    nonce: uint,
    quote-id: (buff 32)
}
```

Per-intent receipts should normally be events rather than permanent maps to reduce contract storage.

---

## 12. Operator and protocol claims

### 12.1 Operator claim

```clarity
(claim-operator-earnings
    amount: uint
    recipient: principal)
```

The contract:

1. Verifies `operator-earnings[tx-sender]`.
2. Decreases the accrued amount.
3. Transfers sBTC from the vault to the operator’s recipient.
4. Emits a claim event.

Operators should claim periodically rather than after every batch.

### 12.2 Protocol claim

Protocol earnings may be withdrawn only by a designated treasury principal or governance contract.

```clarity
(claim-protocol-earnings
    amount: uint
    recipient: principal)
```

Changing the treasury principal should require a time-delayed administrative process.

---

## 13. Operator API

### Request quote

```http
POST /v1/quotes
```

Input:

```json
{
  "sender": "SP...",
  "recipient": "SP...",
  "amount_sats": 1000,
  "priority": "standard"
}
```

### Submit intent

```http
POST /v1/intents
```

Input:

```json
{
  "intent": {},
  "signature": "0x...",
  "public_key": "0x..."
}
```

### Intent status

```http
GET /v1/intents/{intent_id}
```

Statuses:

```text
received
validated
queued
quoted
batched
broadcast
confirmed
expired
rejected
invalidated
```

### Batch status

```http
GET /v1/batches/{batch_id}
```

Response should include:

* Batch size.
* Stacks transaction ID.
* Estimated network fee.
* Actual network fee.
* Total user fees.
* Operator earnings.
* Protocol earnings.
* Confirmation status.

---

## 14. Failure handling

### Invalid intent before batching

The operator rejects it without broadcasting.

### Intent invalidated during queueing

The operator removes it and reconstructs the batch.

### Batch simulation failure

The batch is not broadcast. Invalid entries are isolated through binary or incremental simulation.

### Transaction rejected by mempool

The operator rebuilds the transaction with:

* Correct account nonce.
* Updated fee.
* Updated unexpired intents.

Stacks nodes perform signature, nonce, fee, size and transaction-format checks before accepting a transaction into the mempool.

### Transaction remains pending

The operator may replace or resubmit according to current Stacks transaction rules, provided the user intents remain valid.

### Intent expires after broadcast

Expiration should be evaluated during contract execution. If it has expired by execution time, the batch aborts.

Operators must therefore include an execution-time safety window when selecting intents.

---

## 15. Security requirements

### Replay protection

Every sender has a monotonically increasing OSSR nonce.

A successful intent consumes exactly one nonce.

### Domain separation

Signatures must include:

* OSSR application name.
* Protocol version.
* Chain ID.
* Vault contract principal.

### Exact authorization

The signature covers:

* Payment amount.
* Recipient.
* Every fee component.
* Operator.
* Nonce.
* Quote.
* Expiration.

### No arbitrary operator withdrawals

Operators cannot debit a user without a corresponding valid signature.

### Balance safety

The contract checks:

```text
balance >= amount + all fees
```

before modifying state.

### Emergency pause

Administrative authority may pause:

* New deposits.
* Batch settlements.
* Operator claims.

User withdrawals should remain available whenever safely possible.

### Operator key security

Operators should separate:

* Hot transaction-signing key.
* Cold treasury key.
* Administrative key.
* Monitoring infrastructure.

### Contract versioning

The initial vault should be immutable after deployment or use narrowly constrained upgrade mechanisms. New versions should require explicit user migration rather than giving an administrator unrestricted control over pooled funds.

### Audit requirement

Mainnet launch requires:

* Contract audit.
* SDK signature-vector tests.
* Accounting-invariant tests.
* Property-based tests.
* Replay and nonce tests.
* Malicious-operator tests.
* Batch-failure tests.
* Cost-limit tests.

---

## 16. Economic benefits

### 16.1 Lower average network cost

For `N` individual transactions:

```text
individual total cost
=
N × (
    transaction overhead
    + authorization overhead
    + transfer execution
)
```

For one OSSR batch:

```text
batch total cost
=
one transaction overhead
+ one operator authorization
+ N × (
    intent verification
    + accounting update
    + transfer item
)
```

The fixed transaction and fee-payer overhead is shared across the batch.

The exact savings must be measured because SIP-018 verification and internal accounting add per-intent execution cost.

### 16.2 Higher protocol revenue density

OSSR collects a protocol fee from every intent while submitting only one Stacks transaction:

```text
protocol revenue per chain transaction
=
batch size × protocol fee per intent
```

Example:

```text
25 intents × 2 sats
= 50 sats protocol revenue
```

### 16.3 Operator margin aggregation

An operator earns a small margin from every participant:

```text
25 intents × 4 sats
= 100 sats gross service margin
```

A low per-user margin can therefore produce meaningful batch-level revenue.

### 16.4 Reduced nonce pressure

Instead of managing one sponsored transaction per user payment, the operator consumes one Stacks account nonce per batch.

This simplifies:

* Pending transaction management.
* Sponsor account liquidity.
* Transaction monitoring.
* Fee replacement.
* Operational reconciliation.

### 16.5 Better capital efficiency

One STX fee payment settles many sBTC payments. The operator requires less STX working capital per completed user payment.

### 16.6 Improved user experience

Users:

* Do not need STX.
* Sign a readable payment authorization.
* See exact satoshi-denominated fees.
* Avoid constructing a full Stacks transaction.
* Can issue several payments from one vault deposit.

---

## 17. Trade-offs

Batching introduces:

* Smart-contract vault risk.
* Pre-funding requirements.
* Settlement latency.
* Dependence on operator availability.
* Atomic batch failure risk.
* More complex accounting.
* Signature-verification execution costs.
* Temporary capital held in the vault.
* Potential operator censorship.

OSSR should expose both modes:

```text
Immediate mode:
individual sponsored transaction

Batch mode:
vault-backed SIP-018 intent settlement
```

Users and applications choose between immediate settlement and lower batch pricing.

---

## 18. Benchmark methodology

For each batch size:

```text
N = 1, 2, 5, 10, 25, 50
```

Measure:

* Serialized transaction size.
* Clarity runtime cost.
* Read count and read length.
* Write count and write length.
* Signature-verification cost.
* Estimated STX fee.
* Confirmed STX fee.
* Average fee per intent.
* Batch construction time.
* Settlement latency.
* Operator gross and net revenue.

Compare against:

1. Individual origin-paid sBTC transfers.
2. Individual OSSR sponsored transactions.
3. OSSR batched settlement.

Primary metric:

```text
average network cost per payment
=
confirmed batch STX fee converted to sats
÷ settled intent count
```

Savings:

```text
batch savings percentage
=
1
- (
    batch network cost
    ÷ equivalent individual network cost
  )
```

No fixed savings percentage should be advertised until measured on testnet and validated against representative mainnet fee conditions.

---

## 19. v0.2 acceptance criteria

The v0.2 batching experiment is complete when:

1. Users can deposit and withdraw sBTC from the vault.
2. At least two independent users can sign payment intents.
3. An operator can settle those intents in one Stacks transaction.
4. Recipients receive the exact authorized amounts.
5. Users are charged only the signed fees.
6. Operator and protocol earnings accrue correctly.
7. A used intent cannot be replayed.
8. Expired intents cannot settle.
9. An unauthorized operator cannot settle another operator’s intent.
10. Invalid signatures are rejected.
11. Insufficient balances are rejected.
12. A failed atomic batch produces no partial balance changes.
13. Batch sizes of 1, 5, 10, 25 and 50 are benchmarked.
14. Cost reports compare batching against individual sponsorship.
15. All accounting invariants pass automated tests.
16. The implementation operates on Stacks testnet.
17. An independent security review is completed before mainnet deployment.

---

## 20. Recommended implementation sequence

### Phase 1: Contract prototype

* Vault balances.
* Deposits and withdrawals.
* SIP-018 verification.
* Nonce management.
* Two-user settlement.

### Phase 2: Batch settlement

* Multi-intent contract input.
* Atomic validation.
* sBTC `transfer-many` integration.
* Operator and protocol accounting.
* Settlement events.

### Phase 3: Operator service

* Quote endpoint.
* Intent queue.
* Fee estimation.
* Batch builder.
* Transaction broadcaster.
* Nonce manager.
* Confirmation monitor.

### Phase 4: Wallet SDK

* Deposit interface.
* Quote comparison.
* SIP-018 intent construction.
* Signature request.
* Intent-status tracking.
* Receipt display.

### Phase 5: Testing and economics

* Clarinet cost reports.
* Testnet load tests.
* Fee-allocation experiments.
* Operator profitability simulation.
* Maximum safe batch-size determination.

### Phase 6: Security

* Threat model.
* Contract audit.
* SDK audit.
* Operational key-management review.
* Emergency-response procedures.

---

## 21. Final protocol proposition

OSSR Batching converts many user payment authorizations into one operator-funded Stacks settlement transaction.

Its economic advantage is not merely that a transaction contains multiple transfers. Its advantage comes from combining:

```text
shared transaction overhead
+ pooled sBTC custody in a constrained vault
+ off-chain SIP-018 authorization
+ one STX-paying operator
+ per-intent operator revenue
+ per-intent OSSR protocol revenue
```

This allows user fees to decrease while operator and protocol earnings grow with batch volume.
