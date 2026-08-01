# Randomized Sponsor Assignment

## Status

- **Protocol:** Open Stacks Sponsor Relay (OSSR)
- **Status:** Draft
- **Scope:** One sponsored transaction per assignment
- **Deferred:** Transaction batching

## Purpose

Assign each sponsored transaction to one relay without a central coordinator. Assignment distributes requests across eligible relays and prevents multiple relays from sponsoring the same origin-signed transaction.

The origin signs the transaction first. The assigned relay validates it, adds the sponsor authorization, pays the STX network fee, and broadcasts it.

## Assignment

The wallet derives a seed from public, protocol-defined data:

```text
assignment_seed = hash(
  previous_confirmed_vrf_seed
  || origin_principal
  || origin_nonce
  || relay_set_hash
)
```

The VRF seed MUST come from a prior confirmed block. A relay-provided value, quote ID, transaction ID, or salt MUST NOT affect assignment.

For each eligible relay, the wallet calculates:

```text
relay_score = sha256(assignment_seed || relay_principal)
```

Relays are ranked by ascending score. The lowest score is the primary relay; subsequent scores define fallback order. Ties are resolved by ascending principal bytes.

## Relay Set

A relay is eligible only if it:

- Is actively registered with a fixed relay and sponsor principal.
- Supports the requested network, action, adapter, and protocol version.
- Has sufficient sponsor balance and transaction capacity.
- Has a recent heartbeat and a fee policy within protocol limits.

The relay set MUST be fixed before the assignment seed becomes known. Registration changes MUST apply only to a later epoch. The wallet MUST use the relay-set hash associated with the selected VRF seed.

Version 1 uses equal selection among eligible relays.

## Sponsorship Flow

For each transaction, the wallet MUST:

1. Obtain the current eligible relay set and its committed hash.
2. Derive the ranked relay list.
3. Request a quote from the primary relay.
4. Build and origin-sign the sponsored transaction using that quote.
5. Submit the origin-signed transaction only to the quoted relay.

The quote MUST bind at least:

- The relay and sponsor principals.
- The origin principal and nonce.
- The action and exact adapter call.
- The sponsor fee and maximum network fee.
- The issue and expiry block heights.

The relay MUST reject a transaction that does not exactly match its signed quote. It MUST add only its own sponsor authorization and MUST NOT modify the origin authorization or contract call.

## Fallback

If the primary relay rejects the request, is unavailable, or allows its quote to expire, the wallet MAY request a new quote from the next-ranked relay.

Changing relays changes the sponsor and quote-bound transaction fields. The wallet MUST therefore build and origin-sign a replacement transaction. The previous quote MUST expire or be invalidated, and the wallet MUST NOT submit both versions concurrently.

Automatic reassignment of an already signed transaction is not supported in version 1.

## Safety Requirements

- One assignment applies to exactly one origin principal and nonce.
- The wallet MUST submit an origin-signed transaction to only one relay at a time.
- A relay MUST process a quote no more than once.
- A relay MUST reject expired, replayed, mismatched, or unsupported transactions.
- The origin nonce is consumed only when a sponsored transaction confirms on-chain.
- Selection alone MUST NOT penalize a relay.
- Reliability penalties MAY apply when a relay issues a quote but repeatedly fails to sponsor valid matching transactions.

## Deferred Features

The following are outside version 1:

- Combining multiple user actions into one settlement transaction.
- Batch leaders, batch nonces, and batch execution windows.
- Contract-enforced relay fallback.
- Weighted assignment and adaptive sharding.

## References

- [OSSR Relay HTTP API](relay-api.md)
- [OSSR Quote Format](quote-format.md)
- [Stacks block production and VRF](https://docs.stacks.co/learn/block-production/mining)
