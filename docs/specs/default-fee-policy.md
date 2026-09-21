# OSSR Default Fee Policy Engine

## Purpose

The OSSR default policy calculates the sBTC fee paid by a user to a relay
operator for sponsoring a Stacks transaction. The operator pays the network
fee in STX, while the adapter transfers the quoted fee to the transaction's
actual sponsor in the same atomic sBTC transaction.

The policy has two goals:

1. keep fees from growing linearly with large transfers; and
2. never intentionally quote below the operator's configured cost floor.

All final fee calculations use integer arithmetic and return whole satoshis.

## Final formula

When no fixed-fee override is configured, the quoted fee is:

```text
scaled_units = ceil(amount_sats / scale_sats)
curve_fee_sats = growth_sats × ceil(log2(1 + scaled_units))

quoted_fee_sats = max(
  1,
  curve_fee_sats,
  cost_floor_sats
)
```

The defaults are:

```text
scale_sats = 100
growth_sats = 2
```

Therefore, the default curve is:

```text
curve_fee_sats = 2 × ceil(log2(1 + ceil(amount_sats / 100)))
```

`ceil(log2(n))` means the smallest integer exponent `e` for which `2^e >= n`.
The implementation finds this exponent with integer operations; it does not
use floating-point logarithms.

## Default curve examples

These examples assume the cost floor is no greater than the curve fee:

| Transfer amount | Scaled units | Curve fee | Effective percentage |
| ---: | ---: | ---: | ---: |
| 1 sat | 1 | 2 sats | 200% |
| 100 sats | 1 | 2 sats | 2% |
| 1,000 sats | 10 | 8 sats | 0.8% |
| 10,000 sats | 100 | 14 sats | 0.14% |
| 100,000 sats | 1,000 | 20 sats | 0.02% |
| 1,000,000 sats | 10,000 | 28 sats | 0.0028% |
| 100,000,000 sats | 1,000,000 | 40 sats | 0.00004% |

The step-shaped curve grows by `growth_sats` whenever the scaled transfer size
crosses another power-of-two boundary. This makes the absolute fee grow slowly
while its percentage of the transfer falls as the transfer becomes larger.

## Cost floor

With dynamic pricing enabled, the relay calculates an operator cost floor:

```text
estimated_network_fee_microstx =
  network_fee_rate_microstx × estimated_transaction_bytes

network_cost_sats = ceil(
  estimated_network_fee_microstx
  × stx_usd_price
  × 100,000,000
  / (1,000,000 × btc_usd_price)
)

cost_floor_sats =
  network_cost_sats
  + infrastructure_cost_sats
  + risk_reserve_sats
  + minimum_profit_sats
```

The network fee rate comes from the configured Stacks API. STX and BTC prices
come from the configured pricing API. Prices are normalized to eight decimal
places before the integer conversion. The final conversion always rounds up so
the operator does not understate its network cost by a fractional satoshi.

Dynamic pricing results are cached for 60 seconds by default. If either pricing
dependency fails or returns invalid data, the engine fails closed with
`PRICING_UNAVAILABLE` and does not issue an unsafe quote.

When dynamic pricing is disabled, `SBTC_BREAK_EVEN_FEE_SATS` is used as the
static cost floor instead.

## Fixed-fee override

Setting `SBTC_SPONSOR_FEE_SATS` disables the logarithmic curve and supplies the
requested fee directly:

```text
quoted_fee_sats = max(1, fixed_fee_sats, cost_floor_sats)
```

The cost floor still applies. A fixed fee is therefore not permission to quote
below the operator's calculated costs.

## Configuration

| Environment variable | Default | Meaning |
| --- | ---: | --- |
| `SBTC_LOG_SCALE_SATS` | `100` | Transfer-size divisor used before applying the logarithm |
| `SBTC_LOG_GROWTH_SATS` | `2` | Satoshis charged for every curve step |
| `SBTC_SPONSOR_FEE_SATS` | unset | Optional fixed-fee override |
| `SBTC_DYNAMIC_PRICING` | `true` | Enables the live cost floor |
| `SBTC_ESTIMATED_TRANSACTION_BYTES` | `600` | Conservative sponsored transaction size estimate |
| `SBTC_INFRASTRUCTURE_COST_SATS` | `0` | Per-transaction operating cost allowance |
| `SBTC_RISK_RESERVE_SATS` | `0` | Per-transaction failure or volatility reserve |
| `SBTC_MINIMUM_PROFIT_SATS` | `1` | Minimum profit added to the dynamic floor |
| `SBTC_PRICING_CACHE_SECONDS` | `60` | Lifetime of live pricing inputs |
| `SBTC_PRICING_API_URL` | CoinGecko endpoint | STX and BTC USD price source |
| `SBTC_BREAK_EVEN_FEE_SATS` | `1` | Static floor used when dynamic pricing is disabled |

The scale and growth values must be positive. Invalid values cause
`PRICING_POLICY_INVALID` rather than a fallback to an unintended fee.

## Relay metadata

`GET /v1/info` publishes enough information for a wallet to reproduce its fee
preview. A default-policy response includes fields like:

```json
{
  "limits": {
    "pricingModel": "log2",
    "pricingScaleSats": "100",
    "pricingGrowthSats": "2",
    "minimumSponsorFeeSats": "1",
    "breakEvenFeeSats": "2",
    "pricingPolicy": "max(fixed-or-log2,network-cost+infrastructure+risk+minimum-profit,1)",
    "dynamicPricing": true,
    "estimatedNetworkFeeMicroStx": "600",
    "estimatedNetworkCostSats": "1",
    "infrastructureCostSats": "0",
    "riskReserveSats": "0",
    "minimumProfitSats": "1"
  }
}
```

Integer values are serialized as decimal strings to avoid JavaScript number
precision loss. With the fixed override enabled, `pricingModel` is `fixed` and
`sponsorFeeSats` contains the configured amount.

## Wallet preview and refresh

The reference UI reads `/v1/info`, reproduces the relay formula, and includes
the estimated fee when calculating the maximum transferable amount. It refreshes
pricing metadata every 30 seconds by default and whenever the browser tab becomes
visible again.

The interval is configured with:

```text
NEXT_PUBLIC_OSSR_QUOTE_REFRESH_SECONDS=30
```

Values below five seconds fall back to 30 seconds. A transient refresh failure
keeps the last valid preview instead of replacing it with an unsafe zero value.

The preview is informative, not authoritative. Immediately before wallet
approval, the UI refreshes relay metadata and requests a new signed quote. The
wallet constructs its transaction from the exact signed fee returned in that
quote.

## User fee protection

Every quote request contains `maxSponsorFeeSats`. After calculating the current
fee, the relay compares the result with that user-authorized maximum:

```text
if quoted_fee_sats > maxSponsorFeeSats:
  reject with SPONSOR_FEE_TOO_HIGH (HTTP 422)
```

The relay never silently raises the user's limit. If the live cost floor rises
above the maximum, the user must receive and approve a new price.

The quote then binds the exact sponsor fee, origin, transfer arguments, relay,
policy version, issue height, and expiry height under the relay's signature.
Transaction validation ensures the wallet-signed adapter call and post
conditions match that quote before the operator adds its sponsor signature.

## Operational interpretation

The curve and the cost floor solve different problems:

- The logarithmic curve is the transfer-size price schedule presented to users.
- The cost floor protects the operator from known per-transaction costs.
- `maxSponsorFeeSats` protects the user from an unexpected increase.
- The signed quote freezes the accepted result for its short lifetime.

Operators should tune cost inputs from observed production data. Setting the
floor too low can make successful volume unprofitable; setting it too high can
make small transfers uneconomical. Any intentional below-cost service should be
implemented as an explicit, budgeted subsidy policy rather than by weakening
the default floor.
