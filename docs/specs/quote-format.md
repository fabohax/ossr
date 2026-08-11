# OSSR Quote Format

## Status

- **Protocol:** Open Stacks Sponsor Relay (OSSR)
- **Specification version:** 1
- **Status:** Draft
- **Target environment:** Stacks testnet
- **Supported action:** `sbtc-transfer`
- **Normative signing standard:** SIP-018 Signed Structured Data
- **Last updated:** July 31, 2026

## 1. Purpose

This document defines the version 1 OSSR sponsorship quote. It specifies:

- the fields a relay signs;
- the Clarity types used to encode those fields;
- the exact SIP-018 domain and message;
- the construction of the adapter-argument hash;
- the JSON representation exchanged over HTTP;
- signature verification and key rotation rules; and
- validation requirements for clients and relays.

The signed object is a Clarity value encoded according to SIP-018. JSON is only
a transport representation and MUST NOT be serialized, canonicalized, or hashed
directly for signing.

Version 1 supports one Stacks testnet action: an sBTC transfer through the
allowlisted OSSR sponsored-transfer adapter.

## 2. Conformance language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** in this document are to be interpreted as described in RFC 2119 and
RFC 8174.

An implementation conforms to this specification only if it:

1. constructs the domain and message with the exact names and Clarity types in
   this document;
2. computes hashes and signatures according to SIP-018;
3. rejects unknown protocol versions;
4. validates every invariant in Section 12; and
5. passes the protocol test vectors.

## 3. Design goals

The quote format is designed to provide:

- deterministic signatures across conforming implementations;
- separation between mainnet and testnet;
- separation from other applications and OSSR protocol versions;
- binding to one relay, sponsor, origin, action, and adapter call;
- binding to one reimbursement asset and exact sponsorship fee;
- binding to a maximum STX network fee;
- short, block-height-based validity;
- explicit signing-key identification; and
- safe representation of integers larger than JavaScript's safe integer range.

SIP-018 provides application- and chain-level domain separation. Single-use
enforcement, expiration, transaction matching, and replay prevention remain
OSSR application responsibilities.

## 4. Terminology

| Term | Meaning |
|---|---|
| Origin | The Stacks account authorizing the adapter contract call |
| Sponsor | The Stacks account that adds the sponsor authorization and pays the STX network fee |
| Relay | The service offering and performing sponsorship |
| Quote | A signed relay offer for one exact origin intent |
| Quote key | The relay key used only to sign quotes |
| Sponsor key | The separate key used to sign sponsored Stacks transactions |
| Adapter | The allowlisted Clarity contract that performs the action and reimburses `tx-sponsor?` |
| Base unit | The smallest integer unit of an asset; `sat` for sBTC |
| Consensus serialization | The Stacks wire encoding of a Clarity value |

## 5. Protocol constants

Version 1 uses the following constants:

| Name | Value |
|---|---|
| Protocol version | `"1"` |
| SIP-018 domain name | `"ossr-quote"` |
| SIP-018 domain version | `"1"` |
| Testnet chain ID | `2147483648` (`0x80000000`) |
| Mainnet chain ID | `1` (`0x00000001`) |
| Supported network | `"testnet"` |
| Supported action | `"sbtc-transfer"` |
| Reimbursement asset ID | `"sbtc"` |
| Reimbursement unit | `"sat"` |
| Reimbursement decimals | `8` |
| Quote ID length | 32 bytes |
| Hash length | 32 bytes |
| Compressed public-key length | 33 bytes |
| Recoverable signature length | 65 bytes |
| SIP-018 prefix | `0x534950303138` (`SIP018`) |

A version 1 relay MUST NOT issue a quote for a chain ID other than testnet.
Mainnet uses a future protocol deployment even though SIP-018 defines the
mainnet chain ID.

## 6. SIP-018 domain

The quote-signing domain MUST be the following Clarity tuple:

```clarity
{
  name: "ossr-quote",
  version: "1",
  chain-id: u2147483648
}
```

Its type is:

```clarity
(tuple
  (name (string-ascii 10))
  (version (string-ascii 1))
  (chain-id uint))
```

Implementations MUST construct these values as native Clarity values. They MUST
NOT sign the source-code text shown above.

Changing the protocol version, application name, or target chain requires a
different domain and therefore produces incompatible signatures.

## 7. Signed quote message

### 7.1 Message schema

The SIP-018 structured data message MUST be a Clarity tuple with the following
fields:

```clarity
{
  protocol-version: "1",
  quote-id: 0x<32 bytes>,
  relay-id: "<relay identifier>",
  network: "testnet",
  sponsor: '<standard principal>,
  origin: '<standard principal>,
  action: "sbtc-transfer",
  reimbursement-asset: {
    asset-id: "sbtc",
    contract: '<contract principal>,
    unit: "sat",
    decimals: u8
  },
  adapter-contract: '<contract principal>,
  function-name: "sponsored-transfer",
  arguments-hash: 0x<32 bytes>,
  sponsor-fee: u<fee in sats>,
  max-network-fee-microstx: u<maximum fee>,
  issued-at-block: u<height>,
  expires-at-block: u<height>,
  policy-version: "<operator policy version>",
  key-id: "<quote signing key identifier>"
}
```

The normative field definitions are:

| Field | Clarity type | Requirement |
|---|---|---|
| `protocol-version` | `(string-ascii 1)` | MUST equal `"1"` |
| `quote-id` | `(buff 32)` | Exactly 32 random bytes |
| `relay-id` | `(string-ascii 64)` | Stable, case-sensitive relay identifier |
| `network` | `(string-ascii 7)` | MUST equal `"testnet"` |
| `sponsor` | `principal` | Standard testnet principal controlled by the relay |
| `origin` | `principal` | Standard testnet principal that will sign the transaction origin |
| `action` | `(string-ascii 13)` | MUST equal `"sbtc-transfer"` |
| `reimbursement-asset` | tuple | Asset identity defined below |
| `adapter-contract` | `principal` | Exact allowlisted contract principal |
| `function-name` | `(string-ascii 128)` | MUST equal the configured adapter entry point; initially `"sponsored-transfer"` |
| `arguments-hash` | `(buff 32)` | Hash defined in Section 8 |
| `sponsor-fee` | `uint` | Exact reimbursement in sats |
| `max-network-fee-microstx` | `uint` | Maximum STX fee the relay may place in the sponsor authorization |
| `issued-at-block` | `uint` | Stacks block height used when issuing the quote |
| `expires-at-block` | `uint` | Last Stacks block height at which the quote may be accepted |
| `policy-version` | `(string-ascii 32)` | Version of the relay policy and pricing inputs |
| `key-id` | `(string-ascii 64)` | Identifier of the quote public key |

The `reimbursement-asset` tuple fields are:

| Field | Clarity type | Version 1 value |
|---|---|---|
| `asset-id` | `(string-ascii 32)` | `"sbtc"` |
| `contract` | `principal` | Configured canonical testnet sBTC contract principal |
| `unit` | `(string-ascii 16)` | `"sat"` |
| `decimals` | `uint` | `u8` |

`sponsor`, `origin`, `reimbursement-asset.contract`, and `adapter-contract` MUST
be encoded as Clarity principals, not ASCII address strings. The sponsor and
origin MUST be standard principals. Contract fields MUST be contract principals.

### 7.2 Tuple ordering

Clarity tuple consensus serialization is deterministic and orders tuple keys
according to the Stacks consensus rules. Implementations MUST use the Clarity
tuple constructor and consensus serializer supplied by a compatible Stacks
library.

Implementations MUST NOT depend on JavaScript insertion order, JSON property
order, or the visual field order in this document.

### 7.3 String rules

All quote strings are case-sensitive ASCII.

- Strings MUST contain only printable ASCII bytes from `0x20` through `0x7e`.
- Strings MUST NOT contain leading or trailing whitespace.
- Identifiers MUST NOT be Unicode-normalized because Unicode is not permitted.
- `relay-id`, `policy-version`, and `key-id` MUST be non-empty.
- Receivers MUST reject strings exceeding their declared Clarity bounds rather
  than truncating them.

## 8. Adapter arguments hash

### 8.1 Purpose

`arguments-hash` binds the quote to the exact semantic arguments of the
allowlisted adapter call. It is not a hash of JSON, ABI text, the complete
transaction, or a concatenation of display strings.

### 8.2 Argument commitment

For `sbtc-transfer`, construct this Clarity tuple:

```clarity
{
  amount: u<transfer amount in sats>,
  recipient: '<standard principal>,
  sponsor-fee: u<quoted sponsor fee in sats>,
  quote-id: 0x<same 32-byte quote ID>,
  expiry-height: u<same expires-at-block>,
  memo: <optional (buff 34)>
}
```

Its logical type is:

```clarity
(tuple
  (amount uint)
  (recipient principal)
  (sponsor-fee uint)
  (quote-id (buff 32))
  (expiry-height uint)
  (memo (optional (buff 34))))
```

The recipient MUST be a standard principal. The memo MUST be either:

- Clarity `none`; or
- Clarity `(some 0x...)` containing at most 34 bytes.

An absent JSON memo maps to Clarity `none`. An empty JSON memo (`"0x"`) maps to
`(some 0x)` and is therefore distinct from an absent memo.

The commitment is:

```text
argumentBytes = consensusSerialize(argumentTuple)
argumentsHash = SHA256(argumentBytes)
```

The tuple commits to the function arguments in semantic form. It does not
commit to transaction-level properties such as the origin nonce, anchor mode,
post-condition mode, or post-condition list. Those properties are validated
separately by the relay.

### 8.3 Construction order

A relay MUST:

1. generate `quote-id`;
2. determine `sponsor-fee` and `expires-at-block`;
3. construct the complete argument tuple;
4. compute `arguments-hash`;
5. construct the signed quote message; and
6. sign the message.

The client MUST independently reconstruct the argument tuple and hash before
accepting a quote.

## 9. Signature construction

### 9.1 Hashing

Let:

```text
prefix       = 0x534950303138
domainBytes  = consensusSerialize(domain)
messageBytes = consensusSerialize(quoteMessage)
domainHash   = SHA256(domainBytes)
messageHash  = SHA256(messageBytes)
signingHash  = SHA256(prefix || domainHash || messageHash)
```

The relay signs `signingHash` with the quote private key using ECDSA over
`secp256k1`.

This is the SIP-018 algorithm. Implementations SHOULD use the maintained
`signStructuredData` and `verifyStructuredDataSignature` functionality from
`@stacks/transactions` rather than reimplementing it.

### 9.2 Signature encoding

The signature MUST:

- be a recoverable ECDSA `secp256k1` signature;
- contain exactly 65 bytes;
- use RSV byte order as required by SIP-018; and
- be transported as lowercase `0x`-prefixed hexadecimal.

The public key MUST:

- be a compressed `secp256k1` public key;
- contain exactly 33 bytes; and
- be transported as lowercase `0x`-prefixed hexadecimal.

Receivers MAY accept uppercase hexadecimal for input, but all generated output
MUST be lowercase. Odd-length hex, non-hex characters, or incorrect byte
lengths MUST be rejected.

### 9.3 Key separation

The quote key MUST be distinct from the sponsor transaction-signing key.
Possession of a quote key MUST NOT authorize spending from the sponsor account.

## 10. JSON transport representation

### 10.1 General encoding rules

The HTTP API carries the quote as JSON. The JSON object is not the signed byte
representation.

- Clarity `uint` values MUST be decimal strings with no sign, separators,
  exponent, whitespace, or leading zeroes, except that zero is `"0"`.
- Buffers, hashes, keys, and signatures MUST be lowercase `0x`-prefixed hex.
- Principals MUST use their canonical C32Check string representation.
- JSON numbers MUST NOT be used for protocol integers.
- `null` MUST NOT be used for required fields.
- Unknown fields MAY be present in an API envelope but MUST NOT be interpreted
  as part of a version 1 signed quote.

### 10.2 Quote response

The JSON property names use lower camel case:

```json
{
  "quote": {
    "protocolVersion": "1",
    "quoteId": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "relayId": "ossr-reference-relay",
    "network": "testnet",
    "sponsorPrincipal": "ST...",
    "origin": "ST...",
    "action": "sbtc-transfer",
    "reimbursementAsset": {
      "assetId": "sbtc",
      "contractPrincipal": "ST...sbtc-token",
      "unit": "sat",
      "decimals": "8"
    },
    "adapterContract": "ST...sponsored-transfer",
    "functionName": "sponsored-transfer",
    "argumentsHash": "0x...",
    "sponsorFee": "32",
    "maxNetworkFeeMicroStx": "5000",
    "issuedAtBlock": "123450",
    "expiresAtBlock": "123460",
    "policyVersion": "2026-01",
    "keyId": "quote-key-2026-01"
  },
  "signature": "0x...",
  "quotePublicKey": "0x..."
}
```

`quotePublicKey` is not part of the signed message. Its authenticity comes from
relay metadata obtained from a configured or otherwise trusted relay endpoint.
Clients MUST NOT trust a public key solely because it accompanies a quote.

### 10.3 JSON-to-Clarity mapping

| JSON property | Signed Clarity key |
|---|---|
| `protocolVersion` | `protocol-version` |
| `quoteId` | `quote-id` |
| `relayId` | `relay-id` |
| `network` | `network` |
| `sponsorPrincipal` | `sponsor` |
| `origin` | `origin` |
| `action` | `action` |
| `reimbursementAsset.assetId` | `reimbursement-asset.asset-id` |
| `reimbursementAsset.contractPrincipal` | `reimbursement-asset.contract` |
| `reimbursementAsset.unit` | `reimbursement-asset.unit` |
| `reimbursementAsset.decimals` | `reimbursement-asset.decimals` |
| `adapterContract` | `adapter-contract` |
| `functionName` | `function-name` |
| `argumentsHash` | `arguments-hash` |
| `sponsorFee` | `sponsor-fee` |
| `maxNetworkFeeMicroStx` | `max-network-fee-microstx` |
| `issuedAtBlock` | `issued-at-block` |
| `expiresAtBlock` | `expires-at-block` |
| `policyVersion` | `policy-version` |
| `keyId` | `key-id` |

## 11. Quote issuance

### 11.1 Quote ID

The relay MUST generate `quote-id` with a cryptographically secure random
number generator. It MUST contain 32 bytes and MUST be unique within the
relay's retained quote history.

Sequential database IDs, timestamps, origin nonces, and hashes of predictable
request data MUST NOT be used as quote IDs.

### 11.2 Validity interval

The relay MUST set:

```text
issued-at-block <= expires-at-block
expires-at-block - issued-at-block <= configured maximum quote lifetime
```

The initial recommended lifetime is 5 to 20 Stacks blocks.

A quote is unexpired when the relay's validation chain tip satisfies:

```text
currentBlockHeight <= expires-at-block
```

The relay MUST reject sponsorship when:

```text
currentBlockHeight > expires-at-block
```

The same `expires-at-block` value MUST be passed to the adapter as
`expiry-height`. The adapter MUST apply the corresponding inclusive boundary.

### 11.3 Fees

`sponsor-fee` is the exact amount of sBTC, in sats, that the adapter transfers
from the origin to `tx-sponsor?` if the transaction succeeds.

`max-network-fee-microstx` is the maximum fee, in microSTX, the relay is
authorized to place in the sponsor spending condition. It is an operational
and quote-binding limit; it is not a user payment denominated in STX.

Both values MUST be greater than zero for version 1.

The relay MUST NOT sponsor a transaction whose sponsor authorization fee
exceeds `max-network-fee-microstx`.

### 11.4 Quote request limit

The quote request contains `maxSponsorFeeSats`. This request value is not part
of the signed quote because the response contains the exact `sponsor-fee`.
The relay MUST NOT return a quote whose `sponsor-fee` exceeds the request
limit, and the client MUST repeat that comparison before signing a transaction.

## 12. Validation requirements

### 12.1 Client validation

Before constructing or signing a transaction, a client MUST:

1. reject an unsupported `protocolVersion`;
2. load the expected relay metadata from a trusted configuration or endpoint;
3. select the quote public key identified by `keyId`;
4. verify that the supplied public key matches that trusted key;
5. map every JSON field to the exact Clarity type in this specification;
6. reconstruct the SIP-018 testnet domain;
7. verify the recoverable signature;
8. verify `relayId`, `network`, and `sponsorPrincipal` against relay metadata;
9. verify that all version 1 constant values are exact;
10. verify the origin matches the connected account;
11. verify the adapter contract and function against its allowlist;
12. verify the canonical sBTC contract principal;
13. verify the quoted fee does not exceed the user's requested maximum;
14. verify the block-height validity interval;
15. reconstruct and verify `argumentsHash`;
16. construct the transaction with the exact committed arguments; and
17. add the required exact sBTC post-condition for `amount + sponsor-fee`.

Signature validity alone is insufficient to accept a quote.

### 12.2 Relay validation

Before sponsor signing, the relay MUST:

1. load the stored quote by `quote-id`;
2. compare the submitted quote to the stored signed fields;
3. verify its own quote signature;
4. ensure the quote is unexpired, unused, and not already reserved;
5. deserialize and validate the complete origin-signed transaction;
6. ensure the origin matches `origin`;
7. ensure sponsored authorization is enabled;
8. ensure the contract and function match the quote;
9. reconstruct the argument tuple from the transaction;
10. recompute and compare `arguments-hash`;
11. compare the embedded fee, quote ID, and expiry to the quote;
12. validate the sBTC post-condition and other transaction policy;
13. ensure the selected STX fee does not exceed
    `max-network-fee-microstx`;
14. simulate the transaction at the current chain tip; and
15. atomically consume the quote as part of nonce reservation and signing.

All comparisons of hashes, IDs, public keys, and signatures SHOULD be performed
with constant-time primitives where available.

## 13. Replay protection and idempotency

A valid signature does not make a quote reusable.

- A quote MUST be usable for at most one sponsored transaction.
- The relay MUST persist quote state and enforce an atomic transition from
  available to consumed.
- Duplicate submissions of the same quote and identical origin-signed
  transaction MUST return the previously stored result.
- A duplicate quote with different transaction bytes MUST be rejected.
- Once sponsor-signed transaction bytes exist, the quote MUST remain consumed
  even if broadcast returns an ambiguous result.
- The relay MUST reconcile or rebroadcast the same signed bytes; it MUST NOT
  sign a replacement blindly.
- Expired and rejected quotes MUST NOT be reissued with the same `quote-id`.

The origin nonce, short expiry, signed intent, and durable relay state provide
defense in depth. Cross-relay replay is outside version 1 because each quote is
bound to one relay and sponsor.

## 14. Key publication and rotation

The relay metadata endpoint MUST publish:

- every currently accepted quote public key;
- its `keyId`;
- activation block;
- optional retirement block; and
- status (`active`, `retiring`, or `retired`).

A relay MUST sign new quotes only with an active key. It SHOULD retain a retired
public key until every quote signed by that key has expired and the operational
retention window has passed.

Clients MUST resolve the signed `key-id` against trusted relay metadata.
Unknown, retired-before-issuance, or ambiguous key IDs MUST be rejected.

Key rotation MUST NOT change the relay ID or sponsor identity implicitly. A
sponsor change is reflected by the signed `sponsor` field and relay metadata.

## 15. Error handling

Malformed input MUST fail closed. Implementations MUST distinguish at least:

| Condition | Error code |
|---|---|
| Unsupported protocol/domain version | `QUOTE_VERSION_UNSUPPORTED` |
| Invalid field encoding or Clarity type | `QUOTE_ENCODING_INVALID` |
| Unknown signing key | `QUOTE_KEY_UNKNOWN` |
| Invalid signature | `QUOTE_SIGNATURE_INVALID` |
| Wrong network or chain | `NETWORK_MISMATCH` |
| Untrusted relay or sponsor | `RELAY_IDENTITY_MISMATCH` |
| Expired quote | `QUOTE_EXPIRED` |
| Already consumed quote | `QUOTE_ALREADY_USED` |
| Argument hash mismatch | `ARGUMENTS_MISMATCH` |
| Fee above user limit | `SPONSOR_FEE_TOO_HIGH` |
| Selected STX fee above quote limit | `NETWORK_FEE_TOO_HIGH` |

Error messages MUST NOT expose private keys, raw secret material, or internal
signer state.

## 16. Test vectors

### 16.1 Mandatory SIP-018 baseline

Every implementation MUST first pass the ratified SIP-018 baseline vector:

```text
Domain:
  { name: "Test App", version: "1.0.0", chain-id: u1 }

Message:
  "Hello World"

Structured-data hash:
  5297eef9765c466d945ad1cb2c81b30b9fed6c165575dc9226e9edf78b8cd9e8

Domain hash:
  2538b5dc06c5ae2f11549261d7ae174d9f77a55a92b00f330884695497be5065

Signing hash:
  1bfdab6d4158313ce34073fbb8d6b0fc32c154d439def12247a0f44bb2225259

Private key:
  753b7cc01a1a2e86221266a154af739463fce51219d97e4f856cd7200c3bd2a601

Compressed public key:
  0390a5cac7c33fda49f70bc1b0866fa0ba7a9440d9de647fecb8132ceb76a94dfa

Recoverable RSV signature:
  8b94e45701d857c9f1d1d70e8b2ca076045dae4920fb0160be0642a68cd78de072ab527b5c5277a593baeb2a8b657c216b99f7abb5d14af35b4bf12ba6460ba401
```

### 16.2 OSSR vectors

Before version 1 is marked stable, the `quote-protocol` package MUST generate
and commit machine-readable OSSR fixtures containing:

1. the JSON quote;
2. domain and message Clarity representations;
3. consensus-serialized domain bytes;
4. consensus-serialized message bytes;
5. serialized adapter-argument bytes;
6. `arguments-hash`;
7. domain hash;
8. structured-data message hash;
9. final SIP-018 signing hash;
10. deterministic test public key and signature; and
11. the expected verification result.

At minimum, fixtures MUST cover:

- no memo (`none`);
- an empty memo (`some 0x`);
- a 34-byte memo;
- one value greater than `Number.MAX_SAFE_INTEGER`;
- the inclusive expiry boundary;
- one changed field for every signed field;
- malformed buffer lengths;
- wrong chain ID and domain version;
- wrong key ID and public key; and
- a changed argument with an unchanged `arguments-hash`.

Private keys used in fixtures MUST be clearly marked as public test data and
MUST never be used by a deployed relay.

The generated OSSR hashes are deliberately not handwritten in this draft.
They become normative only when produced by the initial implementation, checked
by a second independent implementation or Clarity verification, and committed
alongside this specification.

## 17. Versioning

Any change to the following requires a new protocol version and SIP-018 domain
version:

- a signed field name or Clarity type;
- a constant value in Section 5;
- the argument commitment schema;
- signature or hash construction;
- integer or hexadecimal encoding rules; or
- the semantic meaning of a signed field.

Adding an unsigned API-envelope field does not require a quote protocol version
change. Adding a new action, reimbursement asset, or network requires a new
reviewed profile and MUST NOT be inferred from version 1.

A receiver MUST NOT ignore, coerce, or guess the meaning of an unknown signed
protocol version.

## 18. Security considerations

- Never sign JSON bytes directly.
- Never accept a quote key delivered only inside the same untrusted response.
- Never treat signature validity as proof that the relay policy is acceptable.
- Never coerce negative, fractional, exponential, or unsafe JSON numbers into
  Clarity `uint` values.
- Never truncate strings or buffers to make malformed input fit.
- Never reuse quote IDs.
- Never use the sponsor transaction key as the quote key.
- Never log private keys or full secret-bearing configuration.
- Avoid logging complete origin intent unless required for the documented
  retention policy.
- Reject a quote if the local chain tip is unavailable or its network cannot be
  established.

## 19. Implementation sketch

The following is illustrative TypeScript. The constructors and verification
function names MUST be checked against the pinned `@stacks/transactions`
version used by the implementation.

```ts
import { Cl, signStructuredData } from "@stacks/transactions";

const domain = Cl.tuple({
  name: Cl.stringAscii("ossr-quote"),
  version: Cl.stringAscii("1"),
  "chain-id": Cl.uint(2147483648n),
});

const message = Cl.tuple({
  "protocol-version": Cl.stringAscii("1"),
  "quote-id": Cl.bufferFromHex(quote.quoteId.slice(2)),
  "relay-id": Cl.stringAscii(quote.relayId),
  network: Cl.stringAscii("testnet"),
  sponsor: Cl.standardPrincipal(quote.sponsorPrincipal),
  origin: Cl.standardPrincipal(quote.origin),
  action: Cl.stringAscii("sbtc-transfer"),
  "reimbursement-asset": Cl.tuple({
    "asset-id": Cl.stringAscii("sbtc"),
    contract: Cl.contractPrincipal(assetAddress, assetContractName),
    unit: Cl.stringAscii("sat"),
    decimals: Cl.uint(8),
  }),
  "adapter-contract": Cl.contractPrincipal(
    adapterAddress,
    adapterContractName,
  ),
  "function-name": Cl.stringAscii("sponsored-transfer"),
  "arguments-hash": Cl.bufferFromHex(quote.argumentsHash.slice(2)),
  "sponsor-fee": Cl.uint(BigInt(quote.sponsorFee)),
  "max-network-fee-microstx": Cl.uint(
    BigInt(quote.maxNetworkFeeMicroStx),
  ),
  "issued-at-block": Cl.uint(BigInt(quote.issuedAtBlock)),
  "expires-at-block": Cl.uint(BigInt(quote.expiresAtBlock)),
  "policy-version": Cl.stringAscii(quote.policyVersion),
  "key-id": Cl.stringAscii(quote.keyId),
});

const signature = signStructuredData({
  domain,
  message,
  privateKey: quotePrivateKey,
});
```

Implementations MUST pin the Stacks library version and MUST verify its
signature byte order against the SIP-018 baseline vector.

## 20. References

- [SIP-018: Signed Structured Data](https://github.com/stacksgov/sips/blob/main/sips/sip-018/sip-018-signed-structured-data.md)
- [Stacks `signStructuredData` reference](https://docs.stacks.co/reference/stacks.js/stacks-transactions/signing/signstructureddata)
- [SIP-005: Blocks and Transactions](https://github.com/stacksgov/sips/blob/main/sips/sip-005/sip-005-blocks-and-transactions.md)
- [SIP-002: Clarity Smart Contract Language](https://github.com/stacksgov/sips/blob/main/sips/sip-002/sip-002-smart-contract-language.md)
- [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119)
- [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)
