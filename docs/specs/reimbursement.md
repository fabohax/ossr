# OSSR v0.1 sBTC reimbursement

## Decision

OSSR v0.1 settles reimbursement **atomically in the sponsored application
transaction**. It does not ask the user to make a second sBTC transfer after
the sponsored transaction confirms, and it has no escrow, balance, or
withdrawal state.

```text
origin signs sponsored adapter call
             |
relay supplies STX fee + sponsor signature
             |
Stacks confirms successful adapter execution
             |
recipient receives amount; tx-sponsor? receives reimbursement
```

The adapter transfers the exact quoted `sponsor-fee` from `tx-sender` to
`tx-sponsor?`, then transfers the requested amount to the recipient. Either
both sBTC transfers succeed or the whole contract call aborts. The source of
truth is the confirmed adapter event and sBTC asset movements, not an
operator's internal accounting record.

## Pricing

All arithmetic uses `bigint`; JSON/API values remain decimal strings. The
quoted reimbursement in sats is:

```text
convertedCost = ceil(networkFeeMicroStx * rateNumerator / rateDenominator)
markup        = ceil(convertedCost * markupBps / 10,000)
quotedFee     = max(minimumReimbursementSats,
                    convertedCost + markup + failureReserveSats)
```

Rounding is always upward. This ensures the operator never silently receives
less than the quoted conversion component. `rateNumerator/rateDenominator` is
a versioned operator policy input measured in sats per microSTX. For a
reproducible testnet MVP, it is a fixed configured rate—not a live price feed.

The initial policy defaults to be published with every relay policy version
are:

| Input | MVP value |
|---|---:|
| Operator markup | 500 bps (5%) |
| Protocol fee | 0 sats |
| Failure reserve | 2 sats |
| Minimum all-in reimbursement | 10 sats |
| Maximum reimbursement | 1,000 sats |

The operator receives the complete quoted fee; v0.1 has no separate protocol
treasury or fee split. A relay may set stricter values, but never exceed the
adapter maximum or the user-provided `maxSponsorFeeSats`.

`packages/sbtc/src/reimbursement.ts` is the reference calculator. The quote
commits only the resulting exact integer `sponsor-fee`, plus the maximum STX
network fee; it does not require the contract to know an exchange rate.

## Confirmation and status

One successful Stacks block confirmation is the MVP settlement requirement.
At that point the recipient transfer and sponsor reimbursement are final for
the v0.1 status API as one atomic result. The relay records the transaction ID,
block height, quoted fee, and observed event/asset movements. It exposes
`confirmed` only after all of these agree.

A confirmed abort is `aborted`, never `confirmed`: no sBTC reimbursement is
owed or retried by the user. The sponsor can still have incurred an STX fee;
the failure reserve prices that accepted testnet risk. Reorg-depth finality,
automatic retries, debt collection, and escrow are explicitly deferred.

## Transaction format

The format is one sponsored Stacks contract-call transaction to
`sbtc-sponsored-transfer-v1.sponsored-transfer` with these arguments:

1. `amount` (`uint`, sats)
2. `recipient` (`principal`)
3. `sponsor-fee` (`uint`, exact quoted sats)
4. `quote-id` (`buff 32`)
5. `expiry-height` (`uint`)
6. `memo` (`optional (buff 34)`)

The user adds a fungible-token post-condition limiting their total sBTC outflow
to `amount + sponsor-fee`. The relay verifies the signed quote and complete
origin-signed transaction, adds the STX fee and sponsor authorization, and
broadcasts. The full adapter format and validation rules are specified in
[clarity-adapter.md](clarity-adapter.md) and [quote-format.md](quote-format.md).
