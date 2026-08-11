# OSSR sBTC Sponsored-Transfer Adapter

## Status

- **Protocol:** Open Stacks Sponsor Relay (OSSR)
- **Adapter version:** 1
- **Status:** Draft
- **Target environment:** Stacks testnet
- **Contract language:** Clarity 3
- **Contract name:** `sbtc-sponsored-transfer-v1`
- **Supported action:** `sbtc-transfer`
- **Reimbursement asset:** sBTC, denominated in sats
- **Last updated:** August 1, 2026

## 1. Purpose

This document defines the version 1 Clarity adapter used by OSSR to perform an
atomic sBTC transfer and reimburse the actual Stacks transaction sponsor.

The adapter proves the PoC's core property:

> A user holding sBTC and no STX can authorize an sBTC transfer; an independent
> relay pays the Stacks network fee in STX; and the recipient transfer and relay
> reimbursement settle atomically in sBTC.

This specification freezes:

- the public function and argument order;
- the pinned sBTC dependency and asset identifier;
- amount, fee, sponsor, recipient, and expiry checks;
- transfer order and memo behavior;
- response and error codes;
- structured event fields;
- post-condition construction and relay validation;
- replay responsibility;
- deployment requirements; and
- required unit, integration, property, and adversarial tests.

The signed off-chain quote is defined by
[quote-format.md](quote-format.md). The relay API is defined by
[relay-api.md](relay-api.md).

## 2. Conformance language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** in this document are to be interpreted as described in RFC 2119 and
RFC 8174.

A conforming version 1 adapter MUST:

1. expose the exact public function in Section 6;
2. use the exact constants and error codes in this document;
3. call only the pinned canonical sBTC token contract;
4. direct reimbursement only to `tx-sponsor?`;
5. perform both sBTC transfers atomically;
6. emit the specified event only after both transfers succeed; and
7. pass the test suite in Section 16.

## 3. Scope

### 3.1 Included

- One adapter deployment on Stacks testnet.
- One action: `sbtc-transfer`.
- One origin principal and one transaction sponsor.
- One recipient transfer.
- One sponsor reimbursement.
- Optional sBTC memo on the recipient transfer.
- Block-height expiration.
- Immutable compile-time amount and fee ceilings.
- Structured `print` event on success.
- Exact fungible-token post-condition requirements.

### 3.2 Excluded

- Mainnet deployment.
- sBTC withdrawal requests.
- Arbitrary SIP-010 assets.
- Arbitrary contract calls.
- Batching or vault accounting.
- On-chain quote-signature verification.
- An on-chain relay registry or sponsor allowlist.
- Contract administration, pausing, or upgrades.
- On-chain fee pricing or STX/sBTC conversion.
- Custody of user funds.

The experimental batching protocol is a separate design and MUST NOT reuse this
adapter's trust or custody assumptions implicitly.

## 4. Security invariants

For every successful call:

1. `tx-sponsor?` is present.
2. The sponsor is the principal in `tx-sponsor?`, never a caller argument.
3. `tx-sender` is the sBTC sender and quote origin.
4. `amount` sBTC moves from `tx-sender` to `recipient`.
5. `sponsor-fee` sBTC moves from `tx-sender` to the sponsor.
6. No other token or STX movement is initiated by the adapter.
7. Total sBTC outflow from `tx-sender` is exactly:

   ```text
   amount + sponsor-fee
   ```

8. The call succeeds only at or before `expiry-height`.
9. Both transfers succeed or both revert.
10. A success event describes the exact executed values.

The adapter cannot guarantee that the sponsor paid an economically fair STX
fee or that the off-chain quote signature is valid. Those checks belong to the
client and relay. The contract guarantees only the on-chain settlement
invariants above.

## 5. Deployment profile

### 5.1 Contract identity

The source filename SHOULD be:

```text
contracts/contracts/sbtc-sponsored-transfer-v1.clar
```

The deployed contract name MUST be:

```text
sbtc-sponsored-transfer-v1
```

The complete deployed principal is selected by the testnet deployment plan and
MUST be published in:

- relay `/v1/info` metadata;
- the relay policy manifest;
- client configuration;
- deployment records; and
- quote fixtures.

A client or relay MUST compare the complete contract principal, not only the
contract name.

### 5.2 Clarity version and epoch

The adapter MUST use Clarity 3 and `stacks-block-height` for expiry. It MUST NOT
use the removed Clarity 1/2 `block-height` keyword or Bitcoin's
`burn-block-height`.

The Clarinet and deployment manifests MUST pin a compatible Stacks epoch rather
than accepting the tool default silently.

### 5.3 Canonical sBTC dependency

The adapter source uses the canonical sBTC requirement principal:

```clarity
(define-constant SBTC_TOKEN
  'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)
```

Clarinet deployment remapping MUST resolve this dependency on testnet to:

```text
ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT.sbtc-token
```

The deployment process MUST inspect the generated transaction plan and verify
that the on-chain source references that expected testnet principal before
broadcast.

The sBTC fungible-token asset identifier used by post-conditions is:

```text
ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT.sbtc-token::sbtc-token
```

The dependency MUST NOT be supplied as a function argument. A dynamic trait
argument would allow the caller to select another token contract and is outside
version 1.

### 5.4 Immutable limits

Version 1 uses:

```clarity
(define-constant MAX_TRANSFER_SATS u10000000)
(define-constant MAX_SPONSOR_FEE_SATS u1000)
```

These values mean:

- maximum recipient transfer: 10,000,000 sats (0.1 BTC); and
- maximum sponsor reimbursement: 1,000 sats.

The relay MAY enforce lower limits. It MUST NOT issue a quote above either
contract limit.

Changing either contract constant requires a new contract deployment and a new
adapter profile. An existing Clarity deployment is immutable.

## 6. Public interface

The adapter exposes exactly one public function:

```clarity
(define-public
  (sponsored-transfer
    (amount uint)
    (recipient principal)
    (sponsor-fee uint)
    (quote-id (buff 32))
    (expiry-height uint)
    (memo (optional (buff 34))))
  ;; body returns (response bool uint)
  ...)
```

Clarity infers the function's return type from its body. The normative return
type is `(response bool uint)`.

The consensus argument order is normative:

1. `amount`
2. `recipient`
3. `sponsor-fee`
4. `quote-id`
5. `expiry-height`
6. `memo`

Adding, removing, reordering, or changing the type of an argument requires a
new adapter version and contract deployment.

### 6.1 `amount`

The exact number of sats transferred to `recipient`.

It MUST satisfy:

```text
1 <= amount <= 10,000,000
```

### 6.2 `recipient`

The principal receiving `amount` sats.

For the PoC, the client and relay MUST require a standard testnet principal.
The contract MUST reject a recipient equal to `tx-sender`.

The contract type permits a contract principal because Clarity's `principal`
type includes both forms. The off-chain standard-principal restriction is
therefore part of the version 1 adapter profile and relay allowlist.

### 6.3 `sponsor-fee`

The exact reimbursement, in sats, transferred to the principal contained in
`tx-sponsor?`.

It MUST satisfy:

```text
1 <= sponsor-fee <= 1,000
```

The user approves this value through the origin signature and exact sBTC
post-condition. The relay MUST ensure it equals the signed quote value.

### 6.4 `quote-id`

An opaque 32-byte identifier generated by the relay. It binds the adapter call,
quote, relay database record, and event.

The contract does not interpret the bytes and does not store the quote ID.

### 6.5 `expiry-height`

The last Stacks block height at which the adapter call may execute.

The boundary is inclusive:

```text
stacks-block-height <= expiry-height  => valid
stacks-block-height >  expiry-height  => ERR_QUOTE_EXPIRED
```

It MUST equal the signed quote's `expiresAtBlock` field.

### 6.6 `memo`

The optional sBTC memo passed only to the recipient transfer.

- `none` means no memo.
- `(some 0x)` means an explicitly present empty memo.
- `(some 0x...)` may contain at most 34 bytes.

The sponsor-fee transfer always uses `none` as its memo. A user memo MUST NOT be
copied to the reimbursement transfer.

## 7. Validation order

The contract MUST perform checks in this order before initiating either token
transfer:

1. reject mainnet execution;
2. unwrap and bind `tx-sponsor?`;
3. require an unexpired quote;
4. require positive `amount`;
5. enforce the transfer ceiling;
6. require positive `sponsor-fee`;
7. enforce the sponsor-fee ceiling;
8. reject `recipient == tx-sender`; and
9. reject `sponsor == tx-sender`.

Stable validation order makes the returned error deterministic when several
conditions are invalid simultaneously.

The contract MAY NOT query a relay, oracle, registry, or pricing source during
validation.

## 8. Settlement sequence

After validation, the adapter MUST:

1. call canonical sBTC `transfer` for `sponsor-fee` from `tx-sender` to the
   unwrapped sponsor with memo `none`;
2. call canonical sBTC `transfer` for `amount` from `tx-sender` to `recipient`
   with the caller-supplied memo;
3. emit the event in Section 11; and
4. return `(ok true)`.

The sponsor reimbursement is attempted first. This order does not weaken
atomicity: if the recipient transfer fails, Clarity rolls back the earlier fee
transfer and event/state effects from the transaction.

The adapter MUST NOT use `as-contract`, because sBTC must leave the user's
principal, not the adapter principal. It calls the sBTC contract with
`sender = tx-sender`. In the nested sBTC call, the original transaction sender
remains `tx-sender` and the adapter becomes `contract-caller`; the canonical
sBTC `transfer` authorization permits the actual sender to transfer their own
tokens.

## 9. Normative contract

The version 1 implementation MUST be behaviorally equivalent to:

```clarity
;; OSSR sBTC sponsored-transfer adapter v1
;; Clarity 3; testnet-only PoC

(define-constant SBTC_TOKEN
  'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)

(define-constant MAX_TRANSFER_SATS u10000000)
(define-constant MAX_SPONSOR_FEE_SATS u1000)

(define-constant ERR_SPONSOR_REQUIRED (err u100))
(define-constant ERR_QUOTE_EXPIRED (err u101))
(define-constant ERR_AMOUNT_ZERO (err u102))
(define-constant ERR_AMOUNT_TOO_HIGH (err u103))
(define-constant ERR_SPONSOR_FEE_ZERO (err u104))
(define-constant ERR_SPONSOR_FEE_TOO_HIGH (err u105))
(define-constant ERR_RECIPIENT_IS_ORIGIN (err u106))
(define-constant ERR_SPONSOR_IS_ORIGIN (err u107))
(define-constant ERR_WRONG_NETWORK (err u108))
(define-constant ERR_FEE_TRANSFER_FAILED (err u109))
(define-constant ERR_RECIPIENT_TRANSFER_FAILED (err u110))

(define-public
  (sponsored-transfer
    (amount uint)
    (recipient principal)
    (sponsor-fee uint)
    (quote-id (buff 32))
    (expiry-height uint)
    (memo (optional (buff 34))))
  (begin
    (asserts! (not is-in-mainnet) ERR_WRONG_NETWORK)
    (let
      (
        (sponsor (unwrap! tx-sponsor? ERR_SPONSOR_REQUIRED))
      )
      (asserts! (<= stacks-block-height expiry-height) ERR_QUOTE_EXPIRED)
      (asserts! (> amount u0) ERR_AMOUNT_ZERO)
      (asserts! (<= amount MAX_TRANSFER_SATS) ERR_AMOUNT_TOO_HIGH)
      (asserts! (> sponsor-fee u0) ERR_SPONSOR_FEE_ZERO)
      (asserts!
        (<= sponsor-fee MAX_SPONSOR_FEE_SATS)
        ERR_SPONSOR_FEE_TOO_HIGH)
      (asserts!
        (not (is-eq recipient tx-sender))
        ERR_RECIPIENT_IS_ORIGIN)
      (asserts!
        (not (is-eq sponsor tx-sender))
        ERR_SPONSOR_IS_ORIGIN)

      (unwrap!
        (contract-call? SBTC_TOKEN transfer
          sponsor-fee
          tx-sender
          sponsor
          none)
        ERR_FEE_TRANSFER_FAILED)

      (unwrap!
        (contract-call? SBTC_TOKEN transfer
          amount
          tx-sender
          recipient
          memo)
        ERR_RECIPIENT_TRANSFER_FAILED)

      (print {
        event: "ossr-sponsored-transfer",
        version: "1",
        quote-id: quote-id,
        origin: tx-sender,
        sponsor: sponsor,
        recipient: recipient,
        amount: amount,
        sponsor-fee: sponsor-fee,
        expiry-height: expiry-height
      })

      (ok true))))
```

The implementation MAY differ in formatting, comments, or private helper
functions. It MUST NOT differ in public interface, validation order, limits,
error mapping, transfer order, event fields, or observable behavior.

Before implementation is accepted, this source MUST compile under the pinned
Clarinet/Clarity configuration. This document is not a substitute for compiler
validation.

## 10. Error codes

Adapter-defined errors occupy `u100` through `u199`.

| Code | Constant | Meaning | Token movement |
|---:|---|---|---|
| `u100` | `ERR_SPONSOR_REQUIRED` | `tx-sponsor?` is `none` | None |
| `u101` | `ERR_QUOTE_EXPIRED` | Current Stacks height exceeds expiry | None |
| `u102` | `ERR_AMOUNT_ZERO` | Recipient amount is zero | None |
| `u103` | `ERR_AMOUNT_TOO_HIGH` | Recipient amount exceeds 10,000,000 sats | None |
| `u104` | `ERR_SPONSOR_FEE_ZERO` | Sponsor reimbursement is zero | None |
| `u105` | `ERR_SPONSOR_FEE_TOO_HIGH` | Reimbursement exceeds 1,000 sats | None |
| `u106` | `ERR_RECIPIENT_IS_ORIGIN` | Recipient equals `tx-sender` | None |
| `u107` | `ERR_SPONSOR_IS_ORIGIN` | Sponsor equals `tx-sender` | None |
| `u108` | `ERR_WRONG_NETWORK` | Contract executes on mainnet | None |
| `u109` | `ERR_FEE_TRANSFER_FAILED` | Canonical sBTC rejected reimbursement | Reverted |
| `u110` | `ERR_RECIPIENT_TRANSFER_FAILED` | Canonical sBTC rejected recipient transfer | Reverted |

The adapter intentionally maps underlying sBTC errors to stable adapter errors.
The relay SHOULD capture simulation diagnostics privately, but API clients MUST
not depend on the current internal sBTC error numbering.

No successful event may be emitted for an error response.

## 11. Event schema

On success, the adapter MUST execute one `print` with this tuple:

```clarity
{
  event: "ossr-sponsored-transfer",
  version: "1",
  quote-id: 0x<32 bytes>,
  origin: '<principal>,
  sponsor: '<principal>,
  recipient: '<principal>,
  amount: u<recipient sats>,
  sponsor-fee: u<fee sats>,
  expiry-height: u<height>
}
```

| Field | Type | Meaning |
|---|---|---|
| `event` | `(string-ascii 23)` | Event discriminator |
| `version` | `(string-ascii 1)` | Event schema version |
| `quote-id` | `(buff 32)` | Submitted quote identifier |
| `origin` | `principal` | `tx-sender` |
| `sponsor` | `principal` | Unwrapped `tx-sponsor?` |
| `recipient` | `principal` | Recipient argument |
| `amount` | `uint` | Recipient amount in sats |
| `sponsor-fee` | `uint` | Sponsor reimbursement in sats |
| `expiry-height` | `uint` | Inclusive quote expiry |

The event deliberately omits the memo. Wallets and indexers can read the memo
from the public transaction arguments without duplicating possibly sensitive
application text in the event.

An indexer MUST identify events by the complete deployed adapter principal and
event discriminator. It MUST NOT trust an arbitrary contract printing a tuple
with the same shape.

## 12. Post-conditions

### 12.1 Required mode

The origin-signed transaction MUST use post-condition mode `Deny`.

This makes asset movements not explicitly permitted by the post-condition list
cause the transaction to abort.

### 12.2 Required condition

The transaction MUST contain exactly one fungible-token post-condition:

| Property | Required value |
|---|---|
| Principal | The origin standard principal |
| Condition | `Equal` |
| Amount | `amount + sponsor-fee` |
| Asset contract | Canonical testnet sBTC contract |
| Asset name | `sbtc-token` |

Conceptually:

```text
origin sends exactly (amount + sponsor-fee)
of ST1F7...sbtc-token::sbtc-token
```

An `Equal` condition is REQUIRED. `LessEqual`, even with the same numeric
limit, is not accepted in version 1 because the known adapter path has an exact
outflow and exact matching is easier to audit.

The client MUST compute `amount + sponsor-fee` with checked integer arithmetic.
The largest valid version 1 total is 10,001,000 sats.

### 12.3 Rejected post-condition forms

The relay MUST reject a transaction that:

- uses `Allow` mode;
- has no sBTC fungible-token condition;
- uses a condition other than `Equal`;
- uses an amount different from `amount + sponsor-fee`;
- names another token contract or asset name;
- assigns the condition to another principal;
- includes additional fungible-token, NFT, STX, or stacking post-conditions;
- contains a contract-principal condition in place of the origin; or
- contains duplicate or semantically overlapping conditions.

Post-conditions are user protection, not a replacement for relay-side payload
validation. The relay MUST still decode and compare every adapter argument.

### 12.4 Sponsor STX fee

The user's sBTC post-condition does not authorize STX outflow from the sponsor.
The sponsor fee in microSTX is placed in the sponsor spending condition and is
bounded by the signed quote's `maxNetworkFeeMicroStx` plus relay policy.

## 13. Quote binding

The quote's `argumentsHash` is the SHA-256 hash of the consensus serialization
of:

```clarity
{
  amount: amount,
  recipient: recipient,
  sponsor-fee: sponsor-fee,
  quote-id: quote-id,
  expiry-height: expiry-height,
  memo: memo
}
```

The types and construction are normative in `quote-format.md`.

Before sponsor signing, the relay MUST verify:

- the exact deployed adapter principal;
- function name `sponsored-transfer`;
- exact argument count, order, types, and values;
- recomputed `argumentsHash`;
- origin principal and origin signature;
- sponsor-enabled transaction authorization;
- network and chain ID;
- post-condition mode and exact post-condition;
- usable origin nonce;
- current block height and quote expiry;
- user available sBTC balance;
- configured execution and economic limits; and
- successful simulation at the current chain tip.

The contract does not parse or verify the SIP-018 quote. The quote signature is
an off-chain relay offer, while the origin-signed transaction authorizes the
actual on-chain call.

## 14. Replay model

### 14.1 Decision

The version 1 adapter is stateless and does not store processed quote IDs.

Replay protection is provided by:

- a cryptographically random 32-byte quote ID;
- the signed quote's relay, sponsor, origin, intent, and expiry binding;
- one-time quote consumption in PostgreSQL;
- sponsorship idempotency;
- the origin transaction nonce;
- the sponsor transaction nonce; and
- relay-controlled broadcast.

### 14.2 Rationale

An on-chain `processed-quotes` map would permanently grow for every transfer
while adding little protection to a transaction that already has unique origin
and sponsor nonces. A globally keyed quote map could also allow quote-ID
preemption if an identifier becomes visible before the intended transaction.

The PoC therefore keeps the adapter minimal and records quote settlement through
the successful event and relay database.

### 14.3 Consequences

- The adapter alone does not prove that a quote ID is globally unique.
- Indexers MUST identify a settlement by adapter principal, txid, and event
  index, not quote ID alone.
- Relays MUST retain quote-consumption state through their documented retention
  period.
- A future multi-relay protocol may add an origin-scoped replay map or signed
  sponsor binding in a new adapter version.

## 15. Atomicity and failure behavior

Clarity transaction semantics make the adapter call atomic:

- if validation fails, neither transfer is attempted;
- if reimbursement fails, recipient transfer is not attempted;
- if recipient transfer fails, reimbursement is reverted;
- if the exact post-condition fails, both transfers revert; and
- the success event is retained only when the overall transaction succeeds.

A failed or aborted Stacks transaction may still charge the sponsor an STX
network fee even though the sBTC reimbursement reverts. The adapter cannot
eliminate this economic risk. The relay mitigates it through simulation,
allowlisting, short expiries, balance checks, limits, and fee reserves.

Simulation is not a guarantee: chain state can change between simulation and
execution.

## 16. Test requirements

### 16.1 Test environment

Contract tests MUST run with:

- pinned Clarinet version;
- pinned Clarity 3 and epoch configuration;
- canonical sBTC contract requirement;
- explicit principal remapping assertions; and
- deterministic origin, sponsor, recipient, and unrelated test accounts.

Test fixtures MUST fund the origin with sBTC and MUST vary origin STX balance,
including zero STX for the end-to-end sponsored case.

### 16.2 Successful calls

Tests MUST cover:

- minimum amount `u1` and fee `u1`;
- maximum amount `u10000000`;
- maximum fee `u1000`;
- expiry equal to `stacks-block-height`;
- absent memo;
- explicitly empty memo;
- 34-byte memo;
- recipient equal to sponsor;
- exact origin decrease of `amount + sponsor-fee`;
- exact recipient increase of `amount`;
- exact sponsor increase of `sponsor-fee`;
- `(ok true)` response; and
- exactly one OSSR event with the required fields.

The canonical sBTC contract may emit its own memo `print` output. Tests MUST
distinguish dependency events from the single OSSR event by contract principal
and event discriminator.

### 16.3 Validation failures

Each error code MUST have an isolated test:

- missing sponsor;
- expired by one block;
- zero amount;
- amount one sat above maximum;
- zero sponsor fee;
- fee one sat above maximum;
- recipient equals origin;
- sponsor equals origin; and
- mainnet execution or equivalent network-profile test.

Tests with several invalid values MUST confirm the validation order in Section
7.

### 16.4 Transfer failures

Tests MUST cover:

- balance below `sponsor-fee`;
- balance sufficient for fee but below `amount + sponsor-fee`;
- locked or otherwise unavailable sBTC where supported by the fixture;
- sBTC reimbursement rejection mapped to `u109`;
- recipient transfer rejection mapped to `u110`;
- no retained reimbursement after recipient-transfer failure; and
- no retained success event after either transfer failure.

### 16.5 Post-condition integration

Transaction-level tests MUST cover:

- exact required post-condition succeeds;
- missing condition aborts under `Deny` mode;
- amount one sat too low aborts;
- amount one sat too high aborts because `Equal` is required;
- wrong principal aborts or is rejected by the relay;
- wrong asset contract or asset name is rejected;
- `LessEqual` is rejected by relay policy;
- `Allow` mode is rejected;
- duplicate and additional post-conditions are rejected; and
- amount-plus-fee construction uses checked arithmetic.

### 16.6 Quote and relay integration

End-to-end tests MUST prove:

- adapter arguments reproduce the quote `argumentsHash`;
- changing each argument breaks the quote comparison;
- quote expiry and adapter expiry use the same inclusive boundary;
- origin-signed bytes remain unchanged after sponsor authorization is added;
- the actual `tx-sponsor?` receives reimbursement;
- a client-supplied sponsor address cannot redirect reimbursement;
- the user begins and ends with zero STX;
- the sponsor pays the complete STX network fee;
- the relay broadcasts the completed transaction; and
- explorer/indexer output contains the expected event and asset transfers.

### 16.7 Property and adversarial tests

Property tests SHOULD generate valid values throughout the allowed ranges and
assert balance conservation:

```text
origin_before - origin_after = amount + sponsor_fee
recipient_after - recipient_before = amount
sponsor_after - sponsor_before = sponsor_fee
```

When recipient equals sponsor:

```text
sponsor_after - sponsor_before = amount + sponsor_fee
```

Adversarial tests SHOULD cover malformed serialized Clarity values, maximum-size
buffers, wrong argument order, wrong function or contract, non-canonical
principals, stale simulation, concurrent submissions, and repeated broadcast.

### 16.8 Cost tests

CI MUST record contract runtime and read/write cost reports for the successful
maximum-value path. A material cost regression requires review even when the
transaction remains below network limits.

The contract performs no map reads or writes; an unexpected state-write cost
outside the sBTC calls is a regression.

## 17. Deployment verification

Before testnet deployment:

1. Pin Clarinet, Clarity version, epoch, and dependency versions.
2. Run static checks and the complete contract suite.
3. Generate the deployment plan.
4. Verify the canonical testnet sBTC principal after remapping.
5. Verify contract name, deployer, limits, source hash, and source code.
6. Verify the deployer has only the STX required for deployment.
7. Deploy the adapter.
8. Compare the on-chain source and code hash to the reviewed artifact.
9. Run read-only/interface checks against canonical sBTC.
10. Publish the adapter principal, txid, block height, code hash, sBTC principal,
    Clarity version, limits, and test results.
11. Update relay policy and `/v1/info` only after verification.
12. Execute a small sponsored canary transfer before enabling public quotes.

If any deployed value differs from the reviewed profile, the relay MUST refuse
startup and signing.

## 18. Upgrade policy

The adapter has no owner, mutable configuration, pause control, or upgrade
function. Changes require deploying a new contract name or principal.

A relay supports an adapter only through an exact principal and code-hash
allowlist. It MUST NOT follow an untrusted registry pointer automatically.

During migration:

- old quotes remain bound to the old adapter principal;
- new quotes use only the newly activated adapter;
- clients verify the adapter against refreshed trusted metadata;
- the relay retains old quote keys and status records through expiry; and
- old adapters remain immutable but are removed from the relay's active policy.

## 19. Known limitations

- The adapter does not verify the signed quote on-chain.
- The adapter does not maintain quote replay state.
- The adapter supports only one transfer and one reimbursement.
- The adapter trusts the pinned canonical sBTC contract's transfer behavior.
- The adapter cannot prevent the sponsor from paying STX for a later-aborted
  transaction.
- The exact post-condition limits aggregate origin sBTC outflow, not each
  recipient independently; relay argument validation supplies the second layer.
- Testnet principal remapping must be reverified whenever the canonical sBTC
  deployment or Clarinet integration changes.
- Mainnet use requires a new deployment profile, security review, and audit.

## 20. References

- [OSSR quote format](quote-format.md)
- [OSSR relay API](relay-api.md)
- [OSSR architecture](../ARCHITECTURE.md)
- [sBTC token contract documentation](https://docs.stacks.co/learn/sbtc/clarity-contracts/sbtc-token)
- [Canonical sBTC token source](https://github.com/stacks-sbtc/sbtc/blob/main/contracts/contracts/sbtc-token.clar)
- [Clarinet sBTC integration and network mappings](https://docs.stacks.co/clarinet/integrations/sbtc)
- [Clarity keywords](https://docs.stacks.co/reference/clarity/keywords)
- [SIP-010 fungible-token standard](https://github.com/stacksgov/sips/blob/main/sips/sip-010/sip-010-fungible-token-standard.md)
- [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119)
- [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)
