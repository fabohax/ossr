# OSSR Operator Liquidity and Profitability Scenarios

## Purpose

This working model helps an OSSR operator estimate the capital needed to run a
relay and compare expected operating results at different liquidity levels. It
is a planning document, not a forecast: OSSR v0.1 is a testnet proof of concept,
and actual demand, fees, confirmation rates, exchange rates, and operating costs
must be measured before treating any scenario as a business case.

## How liquidity works in v0.1

The operator needs **STX working capital** to pay sponsored transaction network
fees. On a successful transaction, the adapter atomically pays the operator's
quoted reimbursement in sBTC. So STX is the immediate throughput constraint;
sBTC is revenue inventory that must eventually be valued or converted back to
STX. The v0.1 flow has no reimbursement waiting period after confirmation, but
it does not automatically convert sBTC into STX.

Track these balances separately:

- **Spendable STX:** available to sponsor transactions.
- **STX safety reserve:** minimum balance held back for pending transactions,
  fee increases, and operational incidents.
- **sBTC receipts:** reimbursements received, less any separately measured
  conversion cost or loss.
- **Growth subsidy budget:** explicit funds used when a user-facing fee is
  below the operator's full cost.

Do not count a locked or unavailable STX balance as usable liquidity. The relay
already supports a minimum balance guard; size it from the operator's safety
policy, not from expected profit.

## Unit economics

Use one consistent valuation snapshot for every quote cohort. Convert the STX
network fee into sats using observed STX/BTC prices, then include the costs that
the reimbursement does not cover:

```text
network_cost_sats = ceil(network_fee_microstx × sats_per_microstx)
realized_revenue_sats = confirmed_reimbursement_sats
total_cost_sats = network_cost_sats
                 + infrastructure_cost_sats
                 + conversion_cost_sats
                 + expected_failure_loss_sats
                 + risk_reserve_sats
contribution_sats = realized_revenue_sats - total_cost_sats
```

For a cohort of `N` attempts, with success rate `p`:

```text
expected_profit_sats = N × p × (revenue_on_success - costs_on_success)
                     - N × (1 - p) × failure_cost_sats
                     - fixed_monthly_cost_sats
```

This separates confirmed sBTC revenue from STX spent on failed attempts. Add
an explicit grant or campaign subsidy to revenue only when that funding is
committed and available. A positive per-success contribution does not by itself
guarantee monthly profitability if utilization is low or fixed costs are high.

The active fee policy matters. The logarithmic fee curve in
[`operator-market-economics.md`](specs/operator-market-economics.md) is a
user-facing schedule; the default fee policy's cost floor is what protects the
operator from known costs. The v0.1 reimbursement policy currently sets a
5% markup, 2-sat failure reserve, and 10-sat minimum by default. Confirm the
running relay configuration and the actual quote before using these defaults
in a forecast.

## Liquidity and throughput

Let:

- `L` = STX available to sponsor work, in microSTX;
- `R` = STX safety reserve, in microSTX;
- `F` = average STX network fee per attempt, in microSTX;
- `D` = average time from signing to confirmed or resolved status, in days;
- `V` = expected attempts per day.

The conservative concurrent-transaction capacity is:

```text
concurrent_capacity = floor((L - R) / F)
throughput_capacity_per_day ≈ concurrent_capacity / D
```

This is a reserve bound, not a promise of throughput. Nonce serialization,
pending transactions, fee variation, API limits, and operational staffing can
reduce actual throughput. For a safe forecast, use a high-percentile observed
fee (for example p95), not only the average, and leave headroom for pending
transactions.

For stable operations, a useful working-capital target is:

```text
target_STX = safety_reserve + (p95_fee × target_concurrent_transactions)
```

The operator should also define a stop threshold that disables new sponsorship
before available STX reaches the safety reserve. Replenishment timing should
include the time needed to value, convert, and return sBTC proceeds to STX.

## Illustrative liquidity cases

The table uses an explicitly hypothetical `F = 20,000 microSTX` per attempt
(0.02 STX), a `R = 0.20 STX` safety reserve, and `D = 0.25 days` to resolution.
These are convenient modeling inputs, **not OSSR fee estimates or claims about
current Stacks fees**. Replace them with observed operator data. Throughput is
an approximate upper bound assuming enough demand and no other bottleneck.

| STX balance | Available after reserve | Approx. concurrent attempts | Approx. capacity/day |
| ---: | ---: | ---: | ---: |
| 0.5 STX | 0.3 STX | 15 | 60 |
| 2 STX | 1.8 STX | 90 | 360 |
| 10 STX | 9.8 STX | 490 | 1,960 |
| 50 STX | 49.8 STX | 2,490 | 9,960 |

At the same fee and resolution time, a higher balance increases capacity but
does not improve contribution per transaction. If quotes are below full cost,
the larger balance only lets the operator absorb losses for longer.

## Illustrative profit scenarios

The following scenarios isolate transaction economics from liquidity. They
assume a 30-day month and show results before fixed monthly costs. All amounts
are hypothetical satoshi equivalents per attempt, not a prediction of OSSR
pricing. The model assumes 1% of attempts fail and each failure costs 7 sats in
STX value. Successful transaction total cost is 10 sats, comprising network,
infrastructure, conversion, and risk costs.

| Case | Attempts/day | Reimbursement on success | Expected monthly result | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Low volume, cost-covering | 25 | 12 sats | +1,448 sats | 2-sat contribution on successes mostly offsets failures |
| Moderate volume, cost-covering | 250 | 12 sats | +14,475 sats | Same per-attempt margin; volume scales the result |
| High volume, thin margin | 1,000 | 10.5 sats | +12,750 sats | 0.5-sat success contribution; failure costs materially reduce margin |
| Growth subsidy | 250 | 8 sats | −15,375 sats | 2-sat subsidy per successful transaction plus failure cost |
| Underpriced | 250 | 7 sats | −22,800 sats | 3-sat loss per success, before fixed costs |

Calculation: `30 × attempts/day × (99% × (reimbursement − 10) − 1% × 7)`.
Rounding of fractional sats is only for presentation; production accounting
should retain integer values per actual transaction. Growth spending should be
reported as a budgeted customer-acquisition expense, not operating profit.

## Scenario interpretation

### Thin liquidity

An operator with only a small balance can validate demand and measure costs,
but should cap outstanding sponsorships tightly. Low utilization means fixed
infrastructure costs can outweigh positive contribution. Prefer a small,
explicitly bounded test or campaign budget until the fee estimator and failure
rate are known.

### Moderate liquidity

A larger working balance supports more concurrent transactions and reduces the
chance of turning away valid requests during fee spikes. This is the most useful
range for learning whether observed demand can cover fixed operating costs.
Increase capacity only when transaction-level accounting shows positive
contribution after conversion and failed-attempt costs.

### Deep liquidity

Large balances improve service continuity and capacity, but create greater
capital exposure and do not fix bad pricing. Before scaling, verify that quotes
refresh with fee and exchange-rate changes, maximum sponsor-fee limits are
honored, and a low-balance stop condition works.

### Subsidized launch

An operator may deliberately accept negative contribution to attract users, but
should set maximum subsidy per transaction, daily budget, eligible volume, and
automatic stop balance. Track campaign-funded transactions separately so that
the operator can distinguish recurring economics from temporary acquisition
spend.

## Demand model for wallet and DeFi integrations

Major wallet integrations can expose OSSR to many Stacks users. Bitflow swaps
and Zest lending actions can provide sponsored use cases such as swaps,
deposits, withdrawals, borrows, and repayments. Published activity is an
**addressable-demand signal**, not OSSR volume: only some actions need
sponsorship, users must opt in, and wallet and protocol activity overlaps.

Public reference points available October 21, 2026:

- Stacks' Q3 report says weekly DEX volume stayed above $10M through most of
  August and September and reached $16.7M in the week of September 28. It
  reports about 1,010 average daily active users for Q3. These are ecosystem
  figures, not eligible wallet request counts. ([Stacks Q3 2026 report](https://www.stacks.co/blog/q3-2026))
- The report also says Bitflow's HODLMM processed more than $280M in Q3 and
  Bitflow had more than $17B cumulative transaction value. Cumulative totals
  are not daily run rates. ([Stacks Q3 2026 report](https://www.stacks.co/blog/q3-2026))
- DefiLlama showed $1.86M of Stacks DEX volume in the 24 hours to October 21,
  identifying Bitflow, Zest, and Velar among tracked protocols. This volatile
  snapshot overlaps with other DEX volume series. ([DefiLlama Stacks dashboard](https://defillama.com/chain/Stacks))
- Zest TVL and lending fees indicate capital deployed but do not reveal the
  number of user actions that could be sponsored. ([DefiLlama Zest dashboard](https://defillama.com/protocol/zest))
- Velar exposes pool volume metrics when data is available. Use its daily
  action counts and volume history in a production estimate rather than a
  single-day snapshot. ([Velar pools](https://app.velar.com/pool))

For an initial DEX proxy, convert daily volume to action counts using an
assumed average ticket, then apply the eligibility and adoption rates:

```text
estimated_actions_per_day = daily_Dex_volume_USD / assumed_average_action_USD
OSSR_sponsored_actions = estimated_actions_per_day
                        × sponsorship_eligible_fraction
                        × OSSR_adoption_share
```

The cases below use $10M/week, or about $1.43M/day, as a rounded baseline.
The ticket sizes are assumptions; DEX volume is not swap count.

| Case | Average action | Eligible for sponsorship | OSSR share of eligible actions | Implied OSSR tx/day |
| --- | ---: | ---: | ---: | ---: |
| Low capture / larger tickets | $1,000 | 1% | 10% | 1.4 |
| Working case | $250 | 5% | 25% | 71.4 |
| High integration / smaller tickets | $100 | 10% | 50% | 714.3 |

The high case combines optimistic assumptions and is an upper stress case
until partners provide funnel data. The $16.7M weekly peak multiplies the
estimates by 1.67; the $1.86M 24-hour snapshot multiplies them by about 1.30.
Do not add these separate baselines together.

Use an independent wallet adoption check. With 1,010 reported ecosystem DAU:

```text
wallet_sponsored_tx_per_day = 1,010 DAU
  × wallet_reach_fraction
  × eligible_actions_per_reached_user_per_day
  × OSSR_adoption_share
```

| Case | Wallet reach | Eligible actions/user/day | OSSR adoption | Implied tx/day |
| --- | ---: | ---: | ---: | ---: |
| Early integration | 1% | 0.05 | 10% | 0.05 |
| Multi-wallet rollout | 10% | 0.10 | 25% | 2.5 |
| Broad wallet adoption | 30% | 0.20 | 50% | 30.3 |

Do not add the wallet estimate to DEX estimates: those wallet users may already
be represented in DEX activity. Measure quote requests by source application
and deduplicate by transaction intent. As integrations launch, replace these
assumptions with wallet DAU, eligible actions, quote requests, accepted quotes,
broadcasts, confirmations, and failures.

## Shared fee pool and operator earnings

Let `T` be confirmed sponsored transactions per day, `C` be contribution per
confirmed transaction in sats after network, infrastructure, conversion, and
risk costs, and `M` be monthly fixed costs in sats:

```text
monthly_pool_sats = 30 × T × C - M - expected_failed_attempt_costs
operator_i_expected_sats = monthly_pool_sats × operator_i_target_share
```

At 71.4 transactions/day, with a hypothetical 2-sat contribution and no fixed
costs, the pool is about 4,284 sats/month. Four equally participating
operators would average about 1,071 sats/month each. If contribution is −2
sats, the same traffic loses about 4,284 sats/month in aggregate; random
routing cannot make negative unit economics profitable. Use measured `C` from
the operator ledger before relying on the model.

## Fair weighted-random operator selection

Run the lottery only among operators whose quote respects the user's fee cap,
whose network and adapter match, whose health is fresh, whose available STX is
above reserve, and whose expected contribution is non-negative. A below-cost
quote is eligible only when a separate subsidy budget covers the gap.

Recommended policy:

1. **Set target shares.** Start with equal shares. Operators may opt into a
   capacity tier based on committed concurrent capacity; use the square root
   of capacity and cap any operator at (for example) twice the median target
   share to limit capital concentration.
2. **Track participation.** Count selected eligible offers over a rolling
   epoch and separately measure fulfillment. A failed assignment does not
   count as earned participation.
3. **Correct toward target.** Use `weight_i = capacity_factor_i ×
   reliability_factor_i × deficit_factor_i`, with
   `deficit_factor_i = max(floor, target_share_i - actual_share_i + smoothing)`.
   Under-served operators get better odds until assignments converge; the
   floor prevents temporary over-target status from starving an operator.
4. **Make draws auditable.** Derive the random value from a future public
   randomness beacon plus signed quote ID and routing epoch. Publish the
   eligible set, weights, and selection proof. If no beacon is available, use
   a committed seed revealed after the quote closes and rotate seed control.
5. **Bound performance effects.** Apply reliability only after a minimum
   sample size and over a rolling window. Use it as an eligibility gate and a
   bounded multiplier. Capacity weighting should be capped or square-rooted,
   never linear in wealth. Price remains a hard user constraint.
6. **Reassign misses.** If the selected operator does not accept or fulfill
   within the published window, record the miss and redraw among remaining
   eligible operators.

For `N` equally eligible operators, equal-share mode gives roughly `1/N`
probability before deficit correction. For unequal targets `q_i`, long-run
assignments should approach `q_i`, subject to eligibility. Publish overall
assignment share and **eligible opportunity share**, so temporary downtime is
not confused with unfair routing.

Avoid using operator stake as the main weight because that concentrates fees
among operators who already have capital. A modest capacity factor supports
service quality while deficit correction gives smaller reliable operators a
path to earn and grow liquidity. Monitor quote opportunities, wins,
acceptance, confirmation, fees, contribution, and reserve headroom per
operator.

At 71.4 tx/day, four equally eligible operators average about 535 confirmed
transactions each per 30-day month. At 2 sats contribution each, that is about
1,071 sats/month apiece before fixed costs. A capacity-capped target of 40%,
30%, 20%, and 10% distributes the same pool as approximately 1,714, 1,285,
857, and 428 sats/month. Choose target shares transparently; weighted random
draws correct short-term variance toward them.

Random selection has high variance at low volume. At 1.4 transactions/day and
four equal operators, each gets an expectation of only about 10.5 confirmed
transactions/month. A minimum opportunity floor or weekly assignment batching
may help, but do not promise minimum revenue unless a treasury funds it.

## Optimistic single-operator weekly case

This is an upside sensitivity case, not a forecast. It assumes the high
integration DEX case above (about 714 OSSR attempts/day) is achieved and one
operator is the only eligible operator for that traffic for the full week. It
uses $10M/week in Stacks DEX volume, a $100 average action, 10% eligible actions,
and 50% OSSR adoption. It further assumes:

- 5,000 attempts/week (714.3 × 7), with 99% confirming;
- 10 sats collected on each confirmed transaction;
- 8 sats of variable cost on each confirmed transaction, including network
  cost, infrastructure, conversion, and risk allowance;
- 7 sats of STX loss for each failed attempt;
- no fixed weekly infrastructure overhead, tax, price movement, or capital
  cost.

| Weekly result | Calculation | Amount |
| --- | --- | ---: |
| Attempts | 714.3 × 7 | 5,000 |
| Confirmed transactions | 5,000 × 99% | 4,950 |
| Sponsor-fee receipts | 4,950 × 10 sats | 49,500 sats |
| Confirmed variable costs | 4,950 × 8 sats | −39,600 sats |
| Failed-attempt network losses | 50 × 7 sats | −350 sats |
| **Estimated operating contribution** | 49,500 − 39,600 − 350 | **9,550 sats/week** |

At an illustrative reimbursement of $0.01 per confirmed transaction, this
would be $49.50 of weekly receipts before costs; that dollar figure is only a
scenario input. The 9,550-sat contribution is before fixed overhead and should
not be read as USD profit without a timestamped BTC/USD conversion rate.

With four equally eligible operators and equal target shares, this same
traffic would give the operator about 1,250 attempts/week. Using the same
success and unit-cost assumptions, its expected contribution would be about
2,388 sats/week. For the single operator to serve the full 714 attempts/day
with the earlier illustrative 20,000-microSTX fee and 0.25-day resolution,
working STX needs to cover about 179 concurrent fees (3.58 STX) plus the 0.20
STX reserve, or roughly 3.8 STX. Actual reserve must use observed high-percentile
fees and pending-transaction exposure.

This case combines high adoption, high operator capture, and positive per
transaction contribution. If the actual fee is below full cost, increasing
volume worsens the result; if integrations route across multiple operators,
each operator receives only its target share. Fixed costs and conversion spread
also reduce the weekly amount.

## Spreadsheet inputs to replace with observed data

At minimum, collect by transaction and by day:

- network fee in microSTX and fee quote at signing;
- sBTC reimbursement quoted and confirmed;
- transaction outcome, confirmation time, and any STX lost on failure;
- STX/BTC conversion rates, source, timestamp, spread, and fees;
- average and peak outstanding STX exposure;
- available STX balance, reserve threshold, and rejected requests due to low
  balance;
- infrastructure and monitoring cost per month;
- demand, successful attempts, cancellations, and subsidy paid.

Use these observations to calculate mean and p95 network cost, success rate,
contribution per confirmed transaction, daily subsidy burn, capacity
utilization, and break-even attempts per month. Re-run scenarios with both
normal and stressed network fees and with slower conversion/replenishment.

## Decision checks before increasing liquidity

1. Reconcile at least several weeks of quote, transaction, and balance data.
2. Confirm the active fee policy covers observed p95 costs or labels the gap as
   a subsidy.
3. Set an STX reserve and stop-sponsoring threshold that includes pending fees.
4. Ensure expected monthly contribution covers fixed costs with a margin for
   volatility; do not use gross reimbursement as profit.
5. Stress the plan with a fee increase, lower success rate, and delayed sBTC to
   STX conversion.
6. Increase the balance only to meet a measured capacity need or funded growth
   plan.

## Limitations

The current operator is testnet-only and has no mature production history. The
example values above are deliberately hypothetical; the historical testnet
case study in the market-economics proposal should not be treated as current
pricing. Mainnet decisions require live fee and exchange-rate observations,
real infrastructure costs, and a verified operational process for converting
sBTC receipts back into STX.
