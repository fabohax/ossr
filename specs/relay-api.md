# OSSR Relay HTTP API

## Status

- **Protocol:** Open Stacks Sponsor Relay (OSSR)
- **API version:** 1
- **Status:** Draft
- **Target environment:** Stacks testnet
- **Supported action:** `sbtc-transfer`
- **Last updated:** August 1, 2026

## 1. Purpose

This document defines the public HTTP API exposed by an OSSR relay. It covers:

- relay metadata and quote-key discovery;
- signed quote creation;
- submission of origin-signed transactions for sponsorship;
- sponsorship and chain-status lookup;
- liveness, readiness, and metrics endpoints;
- request idempotency and retry behavior;
- a stable machine-readable error model; and
- transport-level security and operational requirements.

The API is intentionally narrow. Version 1 supports a single testnet action:
calling the allowlisted OSSR sponsored-transfer adapter to send sBTC while the
relay pays the Stacks network fee in STX.

The signed quote format is defined separately in
[quote-format.md](quote-format.md). If this document conflicts with the quote
format on signed field encoding or signature verification, the quote-format
specification takes precedence.

## 2. Conformance language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** in this document are to be interpreted as described in RFC 2119 and
RFC 8174.

A version 1 conforming relay MUST implement:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/info` | Relay identity, configuration, limits, and quote keys |
| `POST` | `/v1/quotes` | Create a signed, expiring quote |
| `POST` | `/v1/sponsorships` | Validate, sponsor, and broadcast an origin-signed transaction |
| `GET` | `/v1/sponsorships/{txid}` | Return relay and observed chain status |
| `GET` | `/health/live` | Process liveness |
| `GET` | `/health/ready` | Dependency and signer readiness |
| `GET` | `/metrics` | Prometheus-compatible metrics |

The earlier draft paths `/v1/operator`, `/v1/quote`, `/v1/sponsor`, and
`/v1/transactions/{txid}` are obsolete. A conforming server MUST NOT advertise
them as version 1 endpoints. A deployment MAY redirect them temporarily during
development, but clients MUST NOT depend on those redirects.

## 3. API conventions

### 3.1 Base URL and transport

The examples use:

```text
https://relay.example
```

Public relays MUST use HTTPS with a valid certificate. Plain HTTP MAY be used
only for loopback development, local containers, or isolated devnet testing.

The base URL MUST NOT contain a trailing slash. Endpoint paths are appended
exactly as written in this document.

### 3.2 Media types

JSON request bodies MUST use:

```http
Content-Type: application/json
```

JSON responses MUST use:

```http
Content-Type: application/json; charset=utf-8
```

Clients SHOULD send:

```http
Accept: application/json
```

`GET /metrics` uses the Prometheus exposition media type negotiated by the
metrics implementation and is not a JSON endpoint.

A request with an unsupported content type MUST receive `415
UNSUPPORTED_MEDIA_TYPE`. A request that cannot accept the produced response
MAY receive `406 NOT_ACCEPTABLE`.

### 3.3 JSON encoding

API property names use lower camel case.

- Protocol integers MUST be unsigned decimal strings.
- Decimal strings MUST contain only `0` through `9`.
- They MUST NOT contain a sign, decimal point, exponent, separator, whitespace,
  or leading zeroes, except that zero is encoded as `"0"`.
- Hashes, identifiers represented as bytes, public keys, signatures, and
  serialized transactions MUST be lowercase `0x`-prefixed hexadecimal.
- Hex values MUST contain an even number of hexadecimal digits.
- Principals MUST use canonical Stacks C32Check strings.
- Timestamps, when present, MUST use UTC RFC 3339 strings ending in `Z`.
- Required fields MUST NOT be `null`.
- Request objects MUST reject unknown properties unless a schema explicitly
  states otherwise.

JSON is a transport encoding. It MUST NOT be used directly as the byte input to
quote signatures or argument hashes.

### 3.4 API versioning

The major API version appears in the URL as `/v1`.

Within version 1, a relay MAY add:

- optional response properties;
- new error codes;
- new values to explicitly extensible metadata collections; and
- new endpoints.

A relay MUST NOT change the meaning or type of an existing field, remove a
required field, or reuse an error code for a different condition within version
1.

Clients SHOULD ignore unknown response properties. Clients MUST fail closed on
an unknown signed quote protocol version, action, reimbursement asset, or
sponsorship status that affects transaction safety.

### 3.5 Request identifiers

Every response MUST include:

```http
X-Request-Id: <identifier>
```

If the client sends a valid `X-Request-Id`, the relay MAY reuse it. Otherwise,
the relay generates one. A valid request ID contains 16 to 64 characters from:

```text
A-Z a-z 0-9 - _
```

Request IDs are diagnostic identifiers, not authentication tokens and not
idempotency keys.

### 3.6 Cache behavior

The following endpoints MUST return `Cache-Control: no-store`:

- `POST /v1/quotes`;
- `POST /v1/sponsorships`;
- `GET /v1/sponsorships/{txid}`; and
- `GET /health/ready`.

`GET /v1/info` SHOULD return a short cache policy no longer than 60 seconds and
an `ETag`. Quote-key rotations or emergency state changes MUST invalidate that
representation.

`GET /health/live` MAY be cached only by an immediately adjacent orchestrator
and SHOULD otherwise use `no-store`.

### 3.7 Authentication

The public PoC endpoints do not require client authentication. The relay MUST
still enforce request-size, rate, origin, amount, and fee limits.

Future authentication MUST be introduced through a new documented mechanism.
Version 1 clients MUST NOT send origin private keys, seed phrases, sponsor keys,
cookies, or wallet bearer tokens to a relay.

### 3.8 CORS

A relay intended for browser clients MUST use an explicit origin allowlist.
It MUST NOT combine wildcard origins with credentials. Version 1 does not
require cookies or browser credentials.

Permitted request headers SHOULD include only those required by this API, such
as `Content-Type`, `Accept`, `X-Request-Id`, and `Idempotency-Key`.

### 3.9 Compression

Clients MAY send `Accept-Encoding`. Relays MAY compress responses. Relays
SHOULD NOT accept compressed request bodies for the PoC, reducing decompression
bomb and request-accounting ambiguity.

## 4. Common data types

### 4.1 Decimal unsigned integer

```text
^(0|[1-9][0-9]*)$
```

Parsing MUST be checked for the target domain's bounds. An implementation MUST
NOT silently wrap, round, saturate, or coerce an out-of-range value.

### 4.2 Hexadecimal byte string

```text
^0x([0-9a-f]{2})*$
```

Individual fields impose additional byte-length requirements.

### 4.3 Transaction ID

A transaction ID is exactly 32 bytes encoded as 66 lowercase characters,
including the `0x` prefix:

```text
^0x[0-9a-f]{64}$
```

The path form MUST be lowercase. A server MUST return `400 INVALID_TXID` for a
malformed value rather than interpreting it loosely.

### 4.4 Principal

A principal is a canonical testnet standard or contract principal, according to
the field. The `origin`, `recipient`, and `sponsorPrincipal` fields require
standard principals. Contract fields require contract principals.

The relay MUST parse and re-encode principals canonically before comparison.
String prefix checks alone are insufficient validation.

### 4.5 Optional memo

An absent `memo` property means Clarity `none`.

When present, `memo` is a `0x`-prefixed buffer containing at most 34 bytes. The
value `"0x"` means an explicitly present empty memo and is distinct from an
absent property.

## 5. Relay information

### 5.1 Request

```http
GET /v1/info HTTP/1.1
Host: relay.example
Accept: application/json
```

The endpoint takes no query parameters. Unknown query parameters MUST receive
`400 INVALID_QUERY`.

### 5.2 Successful response

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: public, max-age=30
ETag: "info-<configuration-hash>"
X-Request-Id: req_01...
```

```json
{
  "apiVersion": "1",
  "relayId": "ossr-reference-relay",
  "serviceVersion": "0.1.0",
  "buildCommit": "4ea8163a53d310ccff0dfe060c073a545d555597",
  "network": "testnet",
  "chainId": "2147483648",
  "sponsorPrincipal": "ST...",
  "supportedActions": [
    {
      "action": "sbtc-transfer",
      "adapterContract": "ST...sponsored-transfer",
      "functionName": "sponsored-transfer",
      "reimbursementAsset": {
        "assetId": "sbtc",
        "contractPrincipal": "ST...sbtc-token",
        "unit": "sat",
        "decimals": "8"
      }
    }
  ],
  "quoteKeys": [
    {
      "keyId": "quote-key-2026-01",
      "publicKey": "0x02...",
      "status": "active",
      "activatedAtBlock": "123000"
    }
  ],
  "policy": {
    "version": "2026-01",
    "hash": "0x...",
    "quoteLifetimeBlocks": "10",
    "maxTransferSats": "10000000",
    "maxSponsorFeeSats": "1000",
    "maxNetworkFeeMicroStx": "50000"
  },
  "capabilities": {
    "relayBroadcast": true,
    "synchronousSponsorship": true,
    "statusLookup": true
  },
  "availability": {
    "quotesEnabled": true,
    "sponsorshipsEnabled": true
  }
}
```

### 5.3 Field definitions

| Field | Type | Requirement |
|---|---|---|
| `apiVersion` | string | MUST equal `"1"` |
| `relayId` | string | Stable relay identifier used in signed quotes |
| `serviceVersion` | string | Deployed software release identifier |
| `buildCommit` | string | Full source revision or `"unknown"` for local builds |
| `network` | string | MUST equal `"testnet"` in version 1 |
| `chainId` | decimal string | MUST equal `"2147483648"` |
| `sponsorPrincipal` | principal | Active sponsor standard principal |
| `supportedActions` | array | Non-empty allowlisted action profiles |
| `quoteKeys` | array | Keys accepted for quote verification |
| `policy` | object | Current public limits and policy identity |
| `capabilities` | object | Supported optional API behavior |
| `availability` | object | Whether new work is currently accepted |

An action profile uniquely binds an action name to an adapter contract,
function, and reimbursement asset. Version 1 MUST advertise exactly one
`sbtc-transfer` profile.

`policy.hash` is a 32-byte hash of the canonical policy manifest. Its exact
construction is defined by `policy-manifest.md`; until that specification is
stable, the relay MUST still return a stable configured value and version.

`availability` is advisory and may change immediately after the response.
Clients MUST handle a later `503` response.

### 5.4 Quote keys

Each quote key contains:

| Field | Type | Requirement |
|---|---|---|
| `keyId` | string | Matches the signed quote `keyId` |
| `publicKey` | hex | Exactly 33-byte compressed secp256k1 public key |
| `status` | enum | `active`, `retiring`, or `retired` |
| `activatedAtBlock` | decimal string | First block at which the relay issues quotes with the key |
| `retiresAtBlock` | decimal string, optional | Last block for issuance; omission means not scheduled |

The relay MUST include keys needed to verify every unexpired quote it issued.
Only an `active` key may sign a new quote.

Clients require an independent trust decision for the relay base URL and its
metadata. A public key repeated inside a quote response is not independently
trusted merely because it matches this endpoint fetched in the same untrusted
session.

## 6. Create a quote

### 6.1 Request

```http
POST /v1/quotes HTTP/1.1
Host: relay.example
Content-Type: application/json
Accept: application/json
X-Request-Id: req_01...
```

```json
{
  "network": "testnet",
  "origin": "STUSER...",
  "action": "sbtc-transfer",
  "reimbursementAssetId": "sbtc",
  "recipient": "STRECIPIENT...",
  "amountSats": "100000",
  "maxSponsorFeeSats": "100",
  "memo": "0x74657374"
}
```

`memo` is optional. All other properties are required.

### 6.2 Request fields

| Field | Type | Requirement |
|---|---|---|
| `network` | string | MUST equal `"testnet"` |
| `origin` | principal | Origin standard principal |
| `action` | string | MUST equal `"sbtc-transfer"` |
| `reimbursementAssetId` | string | MUST equal `"sbtc"` |
| `recipient` | principal | Recipient standard principal |
| `amountSats` | decimal string | Positive transfer amount within relay policy |
| `maxSponsorFeeSats` | decimal string | Positive maximum the user will accept |
| `memo` | optional hex | At most 34 bytes; absence is Clarity `none` |

The request expresses intent but is not itself signed. A malicious relay could
return a different quote, so the client MUST validate every returned signed
field and reconstruct `argumentsHash` before signing the transaction.

The relay MUST NOT reserve a sponsor nonce when issuing a quote.

### 6.3 Successful response

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
X-Request-Id: req_01...
```

```json
{
  "quote": {
    "protocolVersion": "1",
    "quoteId": "0x...",
    "relayId": "ossr-reference-relay",
    "network": "testnet",
    "sponsorPrincipal": "STSPONSOR...",
    "origin": "STUSER...",
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
  "quotePublicKey": "0x02..."
}
```

The response body MUST conform exactly to the JSON transport representation in
`quote-format.md`.

The relay MUST persist the quote before returning `201`.

### 6.4 Fee-limit outcome

If the calculated sponsor fee exceeds `maxSponsorFeeSats`, the relay MUST NOT
issue a quote. It returns:

```http
HTTP/1.1 422 Unprocessable Content
```

with `SPONSOR_FEE_TOO_HIGH`. The safe error details MAY include the calculated
fee and requested maximum as decimal strings.

### 6.5 Quote retries

Quote creation is intentionally not idempotent. Repeating the same request MAY
produce a new quote ID, fee, expiry, or policy version. Clients SHOULD use the
latest accepted quote and discard earlier unsubmitted quotes.

Issued but unused quotes expire without cost. Relays SHOULD apply rate limits
to prevent quote-table exhaustion.

## 7. Create a sponsorship

### 7.1 Request

```http
POST /v1/sponsorships HTTP/1.1
Host: relay.example
Content-Type: application/json
Accept: application/json
Idempotency-Key: 2f16d680-5a73-4fc7-a66f-e138d84a1c29
X-Request-Id: req_01...
```

```json
{
  "quoteId": "0x...",
  "originSignedTransaction": "0x..."
}
```

### 7.2 Request fields

| Field | Type | Requirement |
|---|---|---|
| `quoteId` | hex | Exactly 32 bytes and identifies a stored quote |
| `originSignedTransaction` | hex | Complete origin-signed, sponsor-enabled Stacks transaction bytes |

The transaction MUST contain the origin signature and MUST NOT already contain
a sponsor signature. The relay treats the entire value as hostile input and
MUST fully deserialize and validate it before sponsor signing.

The request body SHOULD be limited to 256 KiB. A relay MAY configure a smaller
limit that safely accommodates the allowlisted transaction. Oversized requests
MUST receive `413 PAYLOAD_TOO_LARGE` before transaction decoding.

### 7.3 Idempotency key

`Idempotency-Key` is REQUIRED for sponsorship creation. It MUST contain 16 to
128 printable ASCII characters and MUST NOT contain whitespace or control
characters.

The relay computes:

```text
requestHash = SHA256(
  utf8("OSSR-SPONSORSHIP-V1") ||
  quoteIdBytes ||
  originSignedTransactionBytes
)
```

The relay MUST durably bind the tuple `(endpoint, Idempotency-Key)` to
`requestHash` and the sponsorship record before returning a success response.

- Same key and same request hash: return the existing sponsorship result.
- Same key and different request hash: return `409 IDEMPOTENCY_KEY_REUSED`.
- Same quote and same transaction under a different key: return the existing
  sponsorship result.
- Same quote and different transaction: return `409 QUOTE_ALREADY_USED` or
  `409 QUOTE_RESERVED`, depending on durable state.

An idempotent replay MUST never allocate another sponsor nonce or create another
sponsor signature.

### 7.4 Processing model

The PoC uses a synchronous submission pipeline through validation, simulation,
nonce reservation, sponsor signing, persistence, and the initial broadcast
attempt.

The server SHOULD respond within 30 seconds. It MUST NOT return a successful
sponsorship resource before sponsor-signed bytes and the final txid exist. If
the response deadline is reached before signing, the relay returns `503
SPONSORSHIP_IN_PROGRESS`; the client retries the same POST with the identical
body and idempotency key. If processing continues after signed bytes are
durably stored, the relay MAY return `202 Accepted` with the current state.

The client MUST NOT create a different transaction while the quote is reserved.

A closed client connection MUST NOT cause the relay to forget sponsor-signed
bytes or reuse a consumed quote.

### 7.5 First successful response

When the transaction has been sponsor-signed and the initial broadcast has been
accepted or safely classified as already known:

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
Location: /v1/sponsorships/0x...
X-Request-Id: req_01...
```

```json
{
  "txid": "0x...",
  "quoteId": "0x...",
  "status": "broadcast",
  "sponsorPrincipal": "STSPONSOR...",
  "reimbursementAssetId": "sbtc",
  "sponsorFee": "32",
  "networkFeeMicroStx": "4200",
  "createdAt": "2026-08-01T12:00:00Z",
  "updatedAt": "2026-08-01T12:00:01Z"
}
```

The relay MUST NOT return the complete sponsor-signed transaction bytes to the
client. The relay controls broadcast and retries.

### 7.6 Accepted/in-progress response

If processing has been durably accepted but has not reached broadcast:

```http
HTTP/1.1 202 Accepted
Retry-After: 2
Location: /v1/sponsorships/0x...
```

```json
{
  "txid": "0x...",
  "quoteId": "0x...",
  "status": "signed",
  "sponsorPrincipal": "STSPONSOR...",
  "reimbursementAssetId": "sbtc",
  "sponsorFee": "32",
  "networkFeeMicroStx": "4200",
  "createdAt": "2026-08-01T12:00:00Z",
  "updatedAt": "2026-08-01T12:00:01Z"
}
```

The relay can return a txid once sponsor-signed bytes have been created. Before
that point, a timed-out synchronous request SHOULD be recovered by retrying the
same POST with the same idempotency key.

### 7.7 Idempotent replay response

An identical replay returns `200 OK`, `201 Created`, or `202 Accepted` according
to the stored result and server convention. The response MUST include:

```http
Idempotency-Replayed: true
```

The body MUST describe the original sponsorship record, not a new attempt.

### 7.8 Validation rejection

If validation or simulation fails before sponsor-signed bytes exist, the relay
returns a `4xx` error with the stable cause. The quote becomes `rejected` for a
permanent intent mismatch and MAY return to `issued` after a transient upstream
failure when retrying remains safe.

Once sponsor-signed bytes exist, the API MUST NOT report the quote as reusable.
Broadcast ambiguity becomes a sponsorship state, not permission to rebuild and
sign a replacement.

## 8. Get sponsorship status

### 8.1 Request

```http
GET /v1/sponsorships/0x<64 lowercase hex digits> HTTP/1.1
Host: relay.example
Accept: application/json
```

The endpoint takes no query parameters.

### 8.2 Successful response

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
X-Request-Id: req_01...
```

```json
{
  "txid": "0x...",
  "quoteId": "0x...",
  "status": "confirmed",
  "sponsorPrincipal": "STSPONSOR...",
  "reimbursementAssetId": "sbtc",
  "sponsorFee": "32",
  "networkFeeMicroStx": "4200",
  "createdAt": "2026-08-01T12:00:00Z",
  "updatedAt": "2026-08-01T12:02:40Z",
  "chain": {
    "observedAtBlock": "123462",
    "confirmationBlockHeight": "123461",
    "result": "success"
  }
}
```

`chain` is optional until chain information has been observed. Its optional
fields MUST be omitted rather than set to `null`.

### 8.3 Public statuses

| Status | Terminal | Meaning |
|---|---|---|
| `validating` | No | Request is being decoded, checked, or simulated |
| `signed` | No | Sponsor-signed bytes and txid are durably stored |
| `broadcast` | No | Initial broadcast was submitted or reported already known |
| `pending` | No | Transaction is observed in the mempool |
| `confirmed` | Yes | Transaction confirmed and adapter execution succeeded |
| `aborted` | Yes | Transaction confirmed but Clarity execution aborted |
| `dropped` | Yes | Transaction is no longer accepted or observed after policy timeout |
| `failed` | Conditional | Relay cannot continue automatically; operator reconciliation may be required |

`confirmed`, `aborted`, and `dropped` are terminal for version 1.
`failed` MUST include a safe error code and SHOULD be treated as terminal by the
client, but the relay MAY later reconcile it to `broadcast`, `pending`, or a
chain-terminal state if the failure was caused by ambiguous upstream state.

A request rejected before sponsor signing has no final sponsored txid and is
therefore returned as an idempotent POST error, not as a resource addressable by
this status endpoint.

The relay MUST NOT map an on-chain abort to `confirmed`; it uses `aborted`.

### 8.4 Status progression

The normal progression is:

```text
validating -> signed -> broadcast -> pending -> confirmed
     |          |          |           |
     +----------+----------+-----------+-> failed
                +----------+-----------> dropped
                                      \-> aborted
```

Chain observations can skip visible intermediate states. For example, a relay
may move directly from `broadcast` to `confirmed` if it never observes the
transaction in the mempool.

`updatedAt` MUST change whenever the public status or `chain` object changes.

### 8.5 Unknown transaction

A syntactically valid txid not associated with the relay returns:

```http
HTTP/1.1 404 Not Found
```

with `SPONSORSHIP_NOT_FOUND`. The endpoint does not act as a general Stacks
transaction explorer.

## 9. Error model

### 9.1 Error envelope

Every JSON error response MUST use:

```json
{
  "error": {
    "code": "QUOTE_EXPIRED",
    "message": "The quote has expired",
    "requestId": "req_01...",
    "retryable": false,
    "details": {
      "expiresAtBlock": "123460",
      "currentBlockHeight": "123461"
    }
  }
}
```

| Property | Type | Requirement |
|---|---|---|
| `code` | string | Stable uppercase machine-readable code |
| `message` | string | Short safe human-readable description |
| `requestId` | string | Same value as `X-Request-Id` |
| `retryable` | boolean | Whether retrying the same semantic operation may succeed |
| `details` | object, optional | Structured, non-secret context |

Clients MUST make decisions using `code` and HTTP status, not by matching
`message` text.

The relay MUST NOT expose private keys, authorization headers, database errors,
SQL text, stack traces, environment variables, complete transaction bytes,
internal hostnames, or upstream credentials in an error response.

### 9.2 HTTP status semantics

| HTTP status | Use |
|---|---|
| `200` | Successful read or idempotent replay |
| `201` | New quote or sponsorship created |
| `202` | Sponsorship durably accepted and still processing |
| `400` | Malformed syntax, field encoding, path, or unsupported field |
| `404` | Stored quote or sponsorship not found |
| `409` | Replay, reservation, nonce, or idempotency conflict |
| `413` | Request body exceeds limit |
| `415` | Unsupported request media type |
| `422` | Well-formed request violates action, fee, balance, or policy rules |
| `429` | Rate limit exceeded |
| `500` | Unexpected internal failure with no safer classification |
| `502` | Invalid or failed response from required Stacks infrastructure |
| `503` | Relay, database, signer, or upstream dependency unavailable |
| `504` | Required upstream operation timed out |

### 9.3 Stable error codes

#### Request and protocol errors

| Code | HTTP | Retryable |
|---|---:|---:|
| `INVALID_JSON` | 400 | No |
| `INVALID_REQUEST` | 400 | No |
| `INVALID_QUERY` | 400 | No |
| `INVALID_TXID` | 400 | No |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | No |
| `PAYLOAD_TOO_LARGE` | 413 | No |
| `API_VERSION_UNSUPPORTED` | 400 | No |
| `NETWORK_MISMATCH` | 422 | No |
| `ACTION_UNSUPPORTED` | 422 | No |
| `REIMBURSEMENT_ASSET_UNSUPPORTED` | 422 | No |
| `RATE_LIMITED` | 429 | Yes |

#### Quote errors

| Code | HTTP | Retryable |
|---|---:|---:|
| `QUOTE_NOT_FOUND` | 404 | No |
| `QUOTE_VERSION_UNSUPPORTED` | 422 | No |
| `QUOTE_ENCODING_INVALID` | 400 | No |
| `QUOTE_KEY_UNKNOWN` | 422 | No |
| `QUOTE_SIGNATURE_INVALID` | 422 | No |
| `QUOTE_EXPIRED` | 422 | No; request a new quote |
| `QUOTE_RESERVED` | 409 | Yes with the same idempotency key |
| `QUOTE_ALREADY_USED` | 409 | No; retrieve existing status |
| `SPONSOR_FEE_TOO_HIGH` | 422 | No unless the client raises its limit |

#### Transaction validation errors

| Code | HTTP | Retryable |
|---|---:|---:|
| `TRANSACTION_ENCODING_INVALID` | 400 | No |
| `SPONSORED_AUTHORIZATION_REQUIRED` | 422 | No |
| `SPONSOR_AUTHORIZATION_ALREADY_PRESENT` | 422 | No |
| `ORIGIN_SIGNATURE_INVALID` | 422 | No |
| `ORIGIN_MISMATCH` | 422 | No |
| `ORIGIN_NONCE_CONFLICT` | 409 | Yes after rebuilding with a usable nonce |
| `CONTRACT_UNSUPPORTED` | 422 | No |
| `FUNCTION_UNSUPPORTED` | 422 | No |
| `ARGUMENTS_MISMATCH` | 422 | No |
| `SPONSOR_FEE_MISMATCH` | 422 | No |
| `POST_CONDITION_INVALID` | 422 | No |
| `NETWORK_FEE_TOO_HIGH` | 422 | No; request a new quote |
| `INSUFFICIENT_USER_BALANCE` | 422 | Yes after balance changes |
| `SIMULATION_FAILED` | 422 | Conditional |

#### Relay and persistence errors

| Code | HTTP | Retryable |
|---|---:|---:|
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | No |
| `IDEMPOTENCY_KEY_INVALID` | 400 | No |
| `IDEMPOTENCY_KEY_REUSED` | 409 | No with that key |
| `SPONSOR_NONCE_UNAVAILABLE` | 409 | Yes |
| `INSUFFICIENT_SPONSOR_BALANCE` | 503 | Yes after operator action |
| `SIGNING_DISABLED` | 503 | Yes after operator action |
| `SIGNER_UNAVAILABLE` | 503 | Yes |
| `DATABASE_UNAVAILABLE` | 503 | Yes |
| `SPONSORSHIP_IN_PROGRESS` | 503 | Yes, with identical body and key |
| `STACKS_API_UNAVAILABLE` | 503 | Yes |
| `STACKS_API_INVALID_RESPONSE` | 502 | Yes |
| `UPSTREAM_TIMEOUT` | 504 | Yes |
| `BROADCAST_REJECTED` | 502 or 422 | Conditional |
| `SPONSORSHIP_NOT_FOUND` | 404 | No |
| `INTERNAL_ERROR` | 500 | Conditional |

`retryable: true` means retrying may eventually succeed. It does not authorize
the client to change a quote, transaction, or idempotency key. Unless an error
explicitly requires rebuilding, sponsorship retries MUST use the exact same
body and `Idempotency-Key`.

### 9.4 Retry-After

Responses with `429`, `503`, or `202` SHOULD include `Retry-After` in seconds.
Clients SHOULD use exponential backoff with jitter and MUST respect a larger
server-provided delay.

## 10. Rate limits and resource limits

The relay MUST rate-limit at least:

- quote requests per source IP;
- quote requests per origin;
- sponsorship submissions per source IP;
- sponsorship submissions per origin; and
- concurrent simulations and signing operations.

Rate-limit keys MUST NOT rely solely on a client-supplied forwarding header.
The reverse proxy and relay MUST have an explicit trusted-proxy configuration.

Rate-limited responses MUST use `429 RATE_LIMITED` and SHOULD include:

```http
Retry-After: 10
```

The relay MAY publish informational limit headers, but version 1 does not make a
specific rate-limit header standard normative.

Default deployment limits SHOULD include:

| Resource | Recommended PoC limit |
|---|---:|
| JSON request body | 256 KiB |
| Memo | 34 bytes |
| Request processing deadline | 30 seconds |
| Quote lifetime | 5–20 Stacks blocks |
| Database statement timeout | Less than request deadline |
| Upstream HTTP response size | Explicit per-endpoint bound |

Economic limits come from `/v1/info` and the policy manifest rather than being
fixed by this API specification.

## 11. Health endpoints

### 11.1 Liveness

```http
GET /health/live
```

This endpoint answers whether the HTTP process and runtime are responsive. It
MUST NOT perform database, Stacks API, DNS, or signer network calls.

Healthy response:

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
```

```json
{
  "status": "live"
}
```

An unrecoverable process state SHOULD cause the process to terminate rather
than return a misleading liveness success indefinitely.

### 11.2 Readiness

```http
GET /health/ready
```

Readiness checks whether the instance can safely accept new work. It MUST check
at least:

- PostgreSQL connectivity and migration compatibility;
- configured network and chain identity;
- availability of the primary or fallback Stacks API;
- sponsor principal consistency with signer configuration;
- sponsor STX balance above the configured minimum;
- quote-signing key availability;
- sponsor nonce reconciliation state; and
- emergency quote/signing switches.

Ready response:

```http
HTTP/1.1 200 OK
```

```json
{
  "status": "ready",
  "checks": {
    "database": "ok",
    "stacksApi": "ok",
    "quoteSigner": "ok",
    "sponsorSigner": "ok",
    "sponsorBalance": "ok",
    "sponsorNonce": "ok"
  }
}
```

Not-ready response:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 5
```

```json
{
  "status": "not_ready",
  "checks": {
    "database": "ok",
    "stacksApi": "degraded",
    "quoteSigner": "ok",
    "sponsorSigner": "ok",
    "sponsorBalance": "ok",
    "sponsorNonce": "unknown"
  }
}
```

Health details MUST use a small allowlisted vocabulary and MUST NOT expose
credentials, balances, nonces, internal URLs, exception strings, or hostnames.

Readiness MAY distinguish quote availability from sponsorship availability in
internal diagnostics, but it MUST return `503` if accepting either advertised
operation would be unsafe.

## 12. Metrics endpoint

```http
GET /metrics
```

The endpoint MUST expose Prometheus-compatible text. It SHOULD be protected by
network policy, reverse-proxy authentication, or a private listener because
operational labels can reveal traffic patterns.

Metrics MUST NOT use unbounded labels such as txid, quote ID, origin principal,
recipient, IP address, error message, or request ID.

Minimum metric families SHOULD cover:

- HTTP request count and latency by method, route template, and status class;
- quotes issued, expired, rejected, and consumed;
- sponsorship outcomes by bounded status and error code;
- validation and simulation latency;
- sponsor-signing latency and failures;
- broadcast attempts and outcomes;
- pending transaction count and age;
- sponsor nonce reconciliation failures;
- database and Stacks API latency/error counts; and
- readiness and emergency-disable state.

Exact metric names are an operational interface and will be specified in the
runbook or observability specification, not this public API version.

## 13. Security requirements

### 13.1 Input handling

The relay MUST:

- parse JSON with bounded depth and body size;
- reject duplicate JSON object keys;
- reject unknown request fields;
- validate strings and hexadecimal before allocating large buffers;
- parse protocol integers without floating-point conversions;
- fully deserialize transactions using a pinned, reviewed codec;
- reject trailing transaction bytes and non-canonical encodings;
- verify origin signatures before simulation or sponsor signing;
- compare decoded payload and post-conditions to the signed quote; and
- fail closed on unknown payloads, authorization forms, or post-conditions.

### 13.2 Signing boundary

The HTTP layer MUST NOT access raw sponsor or quote private-key material.
Signing occurs through narrow signer interfaces.

Quote and sponsor keys MUST be different. Neither key may appear in responses,
logs, traces, metrics, database rows, panic reports, or error details.

### 13.3 Logging and privacy

Production logs MUST redact:

- complete serialized transactions;
- authorization and cookie headers;
- private keys and secret configuration;
- raw IP addresses unless explicitly required by a documented abuse policy; and
- unnecessary origin and recipient principals.

Request IDs, bounded error codes, route templates, timing, and transaction IDs
after broadcast MAY be logged. Retention periods MUST be documented.

### 13.4 Upstream isolation

Stacks API base URLs are operator configuration, never request parameters. The
relay MUST use fixed allowlisted upstream origins and bounded redirects, body
sizes, connection pools, and timeouts.

Client input MUST NOT influence arbitrary URLs, DNS names, filesystem paths, SQL
identifiers, log templates, or metrics labels.

### 13.5 Response headers

Public deployments SHOULD include:

```http
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
```

The API does not render HTML. Error handlers SHOULD return the JSON error model
even for proxy-visible application errors where practical.

## 14. Client workflow

A conforming client performs:

1. Fetch and authenticate the configured relay's `/v1/info` metadata.
2. Confirm testnet, sponsor identity, action profile, limits, and quote key.
3. Submit the transfer intent to `POST /v1/quotes`.
4. Validate the returned quote according to `quote-format.md`.
5. Build the exact adapter call and exact sBTC post-condition.
6. Mark the transaction as sponsor-enabled and obtain only the origin signature.
7. Generate an idempotency key.
8. Submit the origin-signed bytes to `POST /v1/sponsorships`.
9. Retry ambiguous HTTP failures with the identical body and idempotency key.
10. Poll `GET /v1/sponsorships/{txid}` until a terminal status.
11. Display `aborted`, `dropped`, and `failed` distinctly from successful
    confirmation.

The client MUST NOT broadcast sponsor-completed bytes because the relay does
not return them.

## 15. Conformance tests

A relay implementation MUST have automated tests for at least:

### Metadata

- valid `/v1/info` schema;
- key rotation overlap;
- inconsistent network/configuration startup refusal;
- cache invalidation after key, policy, or availability changes; and
- no secrets in metadata or health responses.

### Quotes

- successful quote creation;
- absent, empty, and 34-byte memo handling;
- invalid principal and integer encodings;
- amount and fee policy boundaries;
- fee above the client's maximum;
- unavailable pricing or chain tip;
- random unique quote IDs under concurrency;
- quote persistence before response; and
- quote compatibility with the golden SIP-018 fixtures.

### Sponsorships

- successful validation, signing, persistence, and broadcast;
- invalid or truncated transaction bytes;
- wrong network, origin, contract, function, arguments, fee, or expiry;
- missing, excessive, or ambiguous post-conditions;
- invalid origin signature;
- expired, missing, reserved, and consumed quotes;
- simulation failure;
- sponsor fee and network fee boundaries;
- concurrent submissions for one and several quotes;
- same idempotency key with same and different bodies;
- same quote submitted under different idempotency keys;
- client disconnect at every durable state transition;
- database interruption before and after sponsor signing;
- broadcast timeout, rejection, and already-known response; and
- confirmation, abort, drop, and reconciliation status updates.

### HTTP behavior

- unsupported content type;
- malformed JSON and duplicate keys;
- unknown request properties;
- oversized and compressed request bodies;
- request ID validation;
- rate-limit behavior and `Retry-After`;
- CORS allowlist behavior;
- error-envelope schema for every public error code; and
- absence of secret or unbounded values in logs and metric labels.

## 16. OpenAPI artifact

Before API version 1 is marked stable, the repository MUST include a generated
or hand-maintained OpenAPI 3.1 document at:

```text
specs/openapi/relay-v1.yaml
```

The OpenAPI document MUST encode the request/response schemas, formats, status
codes, and examples in this specification. CI MUST validate it and SHOULD run
contract tests against the Rust server and TypeScript client.

This Markdown document remains normative for security invariants, state
semantics, idempotency, and retry behavior that cannot be expressed completely
in OpenAPI.

## 17. Versioning and future extensions

The following require `/v2` or another explicitly versioned protocol profile:

- mainnet support;
- arbitrary contract calls;
- a changed quote-signing schema;
- client-controlled broadcast of sponsor-signed bytes;
- asynchronous submission without an origin-signed transaction;
- incompatible status semantics; or
- a different idempotency model.

Additional explicitly reviewed asset/action profiles MAY be introduced within
the broader OSSR protocol, but a version 1 PoC relay MUST NOT infer safety from
SIP-010 compliance alone.

## 18. References

- [OSSR quote format](quote-format.md)
- [OSSR architecture](../ARCHITECTURE.md)
- [OSSR development plan](../DEVELOPMENT.md)
- [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119)
- [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110)
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457)
- [OpenAPI 3.1 specification](https://spec.openapis.org/oas/v3.1.0)
- [Prometheus exposition formats](https://prometheus.io/docs/instrumenting/exposition_formats/)
