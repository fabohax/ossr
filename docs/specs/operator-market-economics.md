# OSSR Operator Market Economics

## Status

- **Protocol:** Open Stacks Sponsor Relay (OSSR)
- **Status:** Draft proposal
- **Scope:** Multi-operator quoting, routing, subsidies, and sustainable pricing
- **Applies after:** OSSR v0.1 single-operator proof of concept
- **Normative implementation:** Deferred
- **Last updated:** September 20, 2026

## 1. Purpose

OSSR should make sponsored transactions attractive to users without requiring
operators to accept unlimited negative-margin work. This proposal combines a
slow-growing user-facing logarithmic fee with cost-aware operator policy,
reputation-weighted routing, and explicitly funded subsidies.

The intended outcome is a competitive market in which:

- users can transact without holding STX;
- operators recover the STX network fee and operating costs over time;
- reliable operators receive more eligible quote traffic;
- small transfers may be subsidized under visible, bounded policies; and
- wallets can compare price and service quality without trusting registry
  claims as proof of performance.

This document does not change the Stacks fee asset. Operators continue to pay
network fees in STX and receive reimbursement in the quote's supported asset.

## 2. Core unit economics

For an sBTC transfer, an operator's realized result is:

```text
revenue_sats = quoted_sponsor_fee_sats

network_cost_sats =
  stx_fee_microstx / 1_000_000
  × stx_usd_price
  / btc_usd_price
  × 100_000_000

profit_sats =
  revenue_sats
  + explicit_subsidy_sats
  - network_cost_sats
  - infrastructure_cost_sats
  - risk_reserve_sats
```

Exchange-rate inputs MUST identify their source and observation time. Operators
SHOULD include a bounded volatility reserve because the quote and settlement
occur at different times.

More routed volume does not repair negative unit economics:

```text
negative margin × more transactions = larger aggregate loss
```

Reputation therefore has economic value only when it results in profitable
traffic, permits a reliability premium, or earns an explicit external reward.

## 3. User-facing logarithmic target

The default curve grows by two sats whenever the scaled transfer size doubles:

```text
scaled_units = ceil(transfer_amount_sats / 100)
log_fee_sats = 2 × ceil(log2(1 + scaled_units))
```

The base-2 curve is deterministic and integer-only. It charges 2 sats at 100
sats, 8 at 1,000, 14 at 10,000, 20 at 100,000, 28 at 1,000,000, and 40 at
100,000,000 sats. It deliberately becomes a smaller percentage as transfers
grow. It is not, by itself, a guarantee that an operator recovers its costs.

## 4. Sustainable quote formula

An unsubsidized operator SHOULD calculate a cost floor:

```text
cost_floor_sats = ceil(
  network_cost_sats
  + infrastructure_cost_sats
  + risk_reserve_sats
)

quoted_fee_sats = max(
  log_fee_sats,
  cost_floor_sats
)
```

An operator targeting a margin may instead use:

```text
margin_floor_sats = ceil(total_cost_sats / (1 - target_margin))

quoted_fee_sats = max(log_fee_sats, margin_floor_sats)
```

For example, a 20% target margin divides total cost by `0.80` before rounding.
The quote MUST still respect the user's `maxSponsorFeeSats` limit.

The relay implements the zero-profit floor as `SBTC_BREAK_EVEN_FEE_SATS`:

```text
quoted_fee_sats = max(
  1,
  2 × ceil(log2(1 + ceil(amount_sats / 100))),
  break_even_fee_sats
)
```

Operators can tune the curve with `SBTC_LOG_SCALE_SATS` and
`SBTC_LOG_GROWTH_SATS`, or opt into a fixed fee with
`SBTC_SPONSOR_FEE_SATS`. Relays advertise the active model and parameters in
`GET /v1/info` so clients can reproduce fee previews and MAX calculations.

The operator MUST update this input when its estimated network, infrastructure,
conversion, or risk cost changes. If the resulting quote exceeds the wallet's
maximum fee, the relay rejects the quote instead of silently underpaying the
operator. A below-cost transaction belongs in an explicitly budgeted subsidy
mode; it must not be described as break-even.

## 5. Service modes

Operators and applications MAY expose one or more of these modes.

### 5.1 Market mode

The user pays the greater of the logarithmic fee and the operator's cost or
margin floor. This is the sustainable default when no third party funds the
difference.

### 5.2 Growth mode

The user pays the logarithmic fee while the operator intentionally absorbs any
shortfall to acquire users, establish performance history, or enter a market.

Growth mode MUST have explicit limits, such as:

- maximum subsidy per transaction;
- maximum subsidy per hour or day;
- maximum number of subsidized transactions per principal or application;
- supported actions and transfer-size bands; and
- an automatic stop when the STX reserve reaches its safety threshold.

Reputation is not an adequate substitute for these limits.

### 5.3 Sponsored campaign mode

An application, merchant, grant, or protocol treasury pays the difference
between the user-facing fee and the operator's required fee:

```text
subsidy_sats = max(0, operator_required_fee_sats - user_fee_sats)
```

Campaign funding MUST be accounted for separately from the user's asset
movement. Wallets SHOULD disclose who funds the subsidy without adding an
unreviewed recipient to the user's transaction.

## 6. Reputation-weighted routing

Reputation is an input to routing, not proof of safety and not a direct source
of revenue. A wallet or quote aggregator MAY rank eligible operators using:

- signed quoted fee;
- successful confirmation rate;
- quote-to-broadcast and broadcast-to-confirmation latency;
- availability and recent heartbeat freshness;
- dropped, replaced, and expired transaction rate;
- nonce-management reliability;
- quote fulfillment rate;
- supported protocol version and adapter; and
- available STX liquidity or published capacity.

One possible normalized routing score is:

```text
score =
  price_weight × price_score
  + reliability_weight × confirmation_score
  + latency_weight × latency_score
  + liquidity_weight × capacity_score
```

The exact weights are client policy. Wallets SHOULD expose enough information
for users or applications to understand why an operator was selected.

Price MUST NOT be ignored: prioritizing a reputable operator that loses money
on every selected quote is not a sustainable market outcome. Higher-reputation
operators MAY charge a visible reliability premium if clients accept it.

## 7. Reputation integrity

Self-reported operator statistics are untrusted. Production reputation SHOULD
be derived from independently verifiable observations such as signed quotes,
quote-store outcomes, chain-confirmed transactions, and time-bounded health
observations.

The design SHOULD mitigate:

- operators generating self-dealing transactions to inflate success counts;
- Sybil operators splitting one identity into many registry entries;
- selective fulfillment of only easy quotes after advertising broad support;
- low introductory pricing followed by unreliable execution;
- applications steering traffic through undisclosed commercial arrangements;
- stale success data masking recent failures; and
- volume-only rankings that reward subsidized losses.

Reputation SHOULD decay with time, distinguish sample size from rate, and
retain separate dimensions rather than collapsing all behavior into one opaque
number.

### 7.1 OSSR reputation receipt (proposed SIP-010 read surface)

OSSR MAY expose earned reputation through a SIP-010-compatible read surface so
wallets and indexers can query an operator balance. It MUST NOT be an ordinary
transferable token: transferable balances measure ownership or purchasing
power, not operational reliability. The `transfer` entry point therefore MUST
reject transfers, and minting MUST be restricted to a protocol recorder that
can prove a unique, chain-confirmed sponsored transfer.

The initial receipt unit is one point per eligible confirmed transfer. A mint
record MUST bind the transaction ID and operator principal, reject replay, and
exclude failed, replaced, self-dealing, and otherwise ineligible transfers.
Clients MUST use the receipt only as a sample-size signal alongside recent
success rate, latency, fee, liquidity, and time decay.

For larger transfers, routing MAY use reputation to break ties between quotes
that already satisfy the user's price and policy constraints. Reputation MUST
NOT override a fee limit, make an insolvent operator eligible, or guarantee
selection. Thresholds and score weights remain wallet policy and MUST be
published.

## 8. Non-normative testnet case study

[Testnet transaction
`0x3a6e…aab71`](https://explorer.hiro.so/txid/0x3a6e8ba2a143832e01f8f0c085fda4c2e735f16a045131ed8cc746c83a9aab71?chain=testnet)
demonstrated the intended atomic flow:

- the recipient received `100` sats;
- the operator received a `1` sat fee;
- the sponsor paid `17,424` microSTX; and
- the transaction confirmed successfully.

At the market-price snapshot used during the September 20, 2026 analysis
(`BTC ≈ $81,059`, `STX ≈ $0.3167`), the network fee was approximately
`$0.00552`, or `6.8` sats, while operator revenue was approximately
`$0.00081`. The operator recovered about 14.7% of the network cost and
subsidized the remainder.

These USD values are illustrative and MUST NOT be used as fixed policy inputs.
At that snapshot, continuous break-even under a one-percent-only fee occurred
at roughly `680` transferred sats before infrastructure and risk costs. If a
network fee costs `$0.16`, the equivalent one-percent break-even transfer is
approximately `19,740` sats, or `$16` at the same BTC price.

## 9. Proposed operator policy advertisement

An operator metadata document could advertise:

```json
{
  "pricing": {
    "percentageBasisPoints": 100,
    "minimumFeeSats": 9,
    "targetMarginBasisPoints": 2000,
    "pricingSource": "operator-defined-uri",
    "pricingMaxAgeSeconds": 60
  },
  "subsidy": {
    "mode": "growth",
    "dailyBudgetSats": 5000,
    "maximumPerTransactionSats": 8
  }
}
```

Advertisements are discovery hints. The signed quote remains the source of
truth for the fee accepted by the user.

## 10. Recommended rollout

1. Keep the one-percent, one-sat-minimum policy for bounded testnet experiments.
2. Record actual STX paid, sats received, latency, status, and pricing inputs
   for every transaction.
3. Add cost-floor calculation and explicit subsidy accounting before mainnet.
4. Let operators opt into bounded growth or campaign subsidies.
5. Introduce reputation-weighted routing only after observations can be
   independently verified.
6. Evaluate batching separately as a potential reduction in cost per user
   intent; do not assume v0.1 single-transaction costs will automatically
   amortize.
7. Publish wallet routing policy and operator economics metrics before calling
   the marketplace production-ready.

## 11. Open questions

- Which pricing source and freshness rules should be mandatory?
- Should the protocol define a standard risk reserve or leave it to operators?
- Who funds small-transfer subsidies after initial growth programs end?
- Can batching preserve atomic user protections while materially lowering
  cost per intent?
- Which reputation observations can be verified without a trusted indexer?
- Should reputation permit a price premium, affect routing priority, or both?
- How should wallets balance cheapest quote, reliability, decentralization,
  and operator concentration?
