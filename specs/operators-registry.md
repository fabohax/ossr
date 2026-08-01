# OSSR Operator Registry

## Status

- **Protocol:** Open Stacks Sponsor Relay (OSSR)
- **Specification version:** 1
- **Status:** Draft
- **Target environment:** Stacks testnet
- **Scope:** Permissionless operator discovery
- **Deferred:** Reputation, slashing, watchers, governance, and operator assignment
- **Last updated:** August 1, 2026

## 1. Purpose

This document defines a permissionless registry through which wallets and
applications discover OSSR operators and their advertised capabilities. The
registry records operator identity, collateral, status, protocol
compatibility, pricing, and a reference to off-chain metadata.

The registry is a discovery mechanism. It does not:

- execute or sponsor transactions;
- select an operator for a wallet;
- guarantee operator availability or honesty;
- verify advertised prices, capacity, or metadata; or
- replace quote and transaction validation.

Wallets MUST validate an operator's signed quote and MUST NOT treat
registration as proof that an operator is trustworthy.

## 2. Conformance language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** in this document are to be interpreted as described in RFC 2119 and
RFC 8174.

An implementation conforms to this specification only if it:

1. enforces the operator lifecycle in Section 6;
2. exposes the registry state defined in Section 7;
3. applies authorization rules to every state change;
4. preserves collateral throughout the withdrawal delay; and
5. treats off-chain metadata as untrusted input.

## 3. Design goals

The registry is designed to provide:

- permissionless operator registration;
- an economic cost for large-scale Sybil registration;
- inexpensive on-chain discovery data;
- operator-controlled, replaceable off-chain metadata;
- explicit protocol and capability negotiation;
- comparable advertised pricing; and
- a minimal base on which later reputation systems can be built.

The version 1 design favors a small, auditable contract. It does not define a
relay marketplace, objective reputation score, or adjudication system.

## 4. Terminology

| Term | Meaning |
|---|---|
| Operator | A service that validates, sponsors, and broadcasts eligible OSSR transactions |
| Owner | The Stacks principal authorized to manage one operator record |
| Operator ID | The registry-assigned identifier of an operator record |
| Collateral | STX locked by an operator while it participates in the registry |
| Metadata document | An off-chain document describing the operator and its service endpoint |
| Metadata URI | A URI from which clients may retrieve a metadata document |
| Capability | A network, action, adapter, or feature supported by an operator |
| Active operator | A registered operator eligible to appear in discovery results |
| Heartbeat | An owner-authorized update indicating recent operator activity |
| Wallet | Any client that discovers, evaluates, or requests service from an operator |

## 5. Architecture

```text
Operator ── register/update/heartbeat ──> Registry contract
                                              │
                                              │ query
                                              v
                                            Wallet
                                              │
                                              │ fetch metadata and request quote
                                              v
                                      Operator HTTPS API
                                              │
                                              v
                                  Sponsored Stacks transaction
```

The on-chain registry is analogous to a directory: it publishes operator
records but does not proxy API requests or take part in sponsorship.

## 6. Operator lifecycle

### 6.1 States

An operator record MUST be in exactly one of these states:

| State | Discoverable | Collateral withdrawable | Meaning |
|---|---:|---:|---|
| `pending` | No | No | Registration exists but activation requirements are not met |
| `active` | Yes | No | Operator may be returned by active-operator queries |
| `inactive` | No | No | Owner has deactivated the operator or its heartbeat has expired |
| `withdrawing` | No | After delay | Owner has requested collateral withdrawal |
| `closed` | No | Yes | Collateral has been returned and the record cannot be reactivated |

### 6.2 Registration

Registration MUST be permissionless. A caller registers an operator by
providing the required fields in Section 7 and locking at least the configured
minimum collateral.

The registry MUST:

1. assign a unique operator ID;
2. set the caller as the owner;
3. record the deposited collateral and creation block height;
4. reject a duplicate active registration for the same owner, if the deployed
   policy limits owners to one record;
5. validate bounded values before storing them; and
6. activate the record only after all activation requirements are satisfied.

Registration MUST NOT require approval from a registry administrator.

### 6.3 Activation and deactivation

An operator MAY activate its record when:

- its collateral meets the current minimum;
- it publishes at least one supported protocol version;
- it publishes the capabilities required for discovery; and
- its metadata reference and pricing record are valid under the contract's
  bounded schema.

Only the owner MAY voluntarily deactivate or reactivate its operator record.
An inactive record MUST NOT be returned as active.

### 6.4 Withdrawal

The owner MAY request collateral withdrawal. A withdrawal request MUST
immediately make the operator non-discoverable and start a delay measured in
Stacks block heights.

Collateral MUST remain locked until the delay expires. The initial deployment
SHOULD configure a delay approximately equivalent to seven days; the contract
MUST express the exact value in blocks.

After the delay, the owner MAY finalize withdrawal. Finalization MUST return the
remaining collateral to the owner and permanently close the record.

Version 1 does not define slashing. Collateral therefore raises the cost of
Sybil registration but does not compensate users or prove good behavior.

### 6.5 Heartbeats

An active operator SHOULD periodically submit an owner-authorized heartbeat.
The registry records the block height of the latest accepted heartbeat.

A heartbeat MUST NOT accept a caller-supplied block height. The contract MUST
use the current chain height. Only the owner MAY update its heartbeat.

Clients SHOULD treat an operator as stale when its latest heartbeat is older
than the configured heartbeat window. A deployment MAY automatically exclude
stale records from active queries. An initial heartbeat window of 500 blocks is
RECOMMENDED but is not a protocol constant until fixed by the deployment.

## 7. Registry state

### 7.1 On-chain operator record

Each record MUST contain at least:

| Field | Requirement |
|---|---|
| `operator-id` | Unique registry-assigned unsigned integer |
| `owner` | Principal authorized to update the record |
| `quote-public-key` | Public key used to verify signed operator quotes |
| `collateral-ustx` | Amount of locked collateral in micro-STX |
| `status` | One lifecycle state from Section 6.1 |
| `created-at-block` | Chain height at registration |
| `updated-at-block` | Chain height of the latest record update |
| `last-heartbeat-block` | Chain height of the latest accepted heartbeat |
| `withdrawal-ready-at` | Optional height after which withdrawal may finalize |
| `metadata-uri` | Bounded URI for the off-chain metadata document |
| `metadata-hash` | Hash of the expected metadata document |
| `protocol-versions` | Bounded set of supported OSSR protocol versions |
| `capabilities` | Bounded representation of supported service capabilities |
| `pricing` | Advertised pricing fields defined in Section 9 |

The deployed Clarity contract MUST define explicit maximum lengths and list
bounds for all stored buffers and strings. Values exceeding those bounds MUST
be rejected rather than truncated.

### 7.2 On-chain and off-chain separation

Information required to filter operators safely SHOULD remain on-chain. Rich or
frequently changing presentation data SHOULD remain off-chain.

| On-chain | Off-chain metadata |
|---|---|
| Operator ID and owner | Operator name and description |
| Quote public key | HTTPS API endpoint |
| Collateral and status | Geographic region |
| Creation and heartbeat heights | Logo and website |
| Protocol versions | Community and support links |
| Capabilities | Detailed policy documentation |
| Advertised pricing | Contact information |
| Metadata URI and hash | Human-readable service terms |

The metadata URI MAY use content-addressed storage such as IPFS or an HTTPS
location. Clients MUST verify the retrieved bytes against `metadata-hash` before
using the document. URI schemes accepted by a client are a client-policy choice.

## 8. Metadata document

The metadata document SHOULD include:

```json
{
  "schema_version": "1",
  "operator_id": "18",
  "name": "Example OSSR Operator",
  "api_url": "https://relay.example/api",
  "region": "us-east",
  "description": "Independent OSSR relay operator",
  "website": "https://relay.example"
}
```

The exact canonical encoding and hash construction MUST be defined before the
registry is implemented. Until then, this JSON object is illustrative and not a
normative wire format.

Clients MUST treat metadata as untrusted. In particular, they MUST NOT render
unescaped markup, follow unsafe URI schemes, or send secrets to an advertised
endpoint merely because it appears in a registered record.

## 9. Advertised pricing and capacity

An operator advertises enough information for wallets to filter or compare
candidate services before requesting a signed quote. The record SHOULD include:

| Field | Meaning |
|---|---|
| `base-fee` | Fixed reimbursement charged per sponsored transaction |
| `percentage-fee-bps` | Variable fee in basis points |
| `maximum-sponsorship-microstx` | Maximum STX network fee the operator advertises it will sponsor |
| `capacity-window` | Unit of the advertised capacity period |
| `capacity-microstx` | Advertised sponsorship capacity for that period |
| `fee-asset` | Asset in which the operator expects reimbursement |

All monetary values MUST identify their unit and asset unambiguously. Integer
base units MUST be used; floating-point values MUST NOT be stored on-chain.

Advertised pricing is informational and MAY become stale. The operator's signed
quote defines the actual offer. A wallet MUST display and validate the quote's
exact fees before requesting an origin signature.

## 10. Capabilities and protocol versions

An operator MUST publish the OSSR protocol versions it supports. It SHOULD also
publish machine-readable capabilities sufficient to filter by:

- Stacks network;
- supported action;
- adapter contract;
- reimbursement asset; and
- optional protocol features.

A wallet MUST ignore operators that do not advertise a compatible protocol
version, network, action, adapter, and reimbursement asset.

Version strings are identifiers, not ordered numbers. A client MUST NOT infer
compatibility from lexical or semantic-version ordering unless a separate OSSR
specification explicitly defines that relationship.

## 11. Discovery and selection

To discover an operator, a wallet SHOULD:

1. query active registry records;
2. exclude stale records;
3. filter for compatible protocol versions and capabilities;
4. retrieve and hash-verify relevant metadata;
5. apply local policy to collateral, pricing, capacity, and endpoint security;
6. request a signed quote from one or more candidates; and
7. validate each quote under the applicable OSSR quote specification.

The registry MUST NOT designate a mandatory operator. Wallets MAY rank eligible
operators using price, observed reliability, latency, privacy policy, geographic
preference, or randomized assignment.

Randomized or weighted assignment is outside this specification. Implementers
using randomized assignment MUST follow the separate OSSR assignment
specification so an operator cannot bias selection.

## 12. Reputation

Version 1 does not define an on-chain reputation score. Clients and independent
indexers MAY derive objective observations such as:

- successful sponsored transactions;
- failed or timed-out requests;
- confirmation latency;
- observed uptime; and
- historical enforcement events in a future slashing system.

Self-reported metrics MUST NOT be treated as verified. A score derived by an
indexer MUST identify its data sources and calculation method. Manual ratings
are discouraged because they are inexpensive to manipulate and difficult to
associate with completed protocol activity.

## 13. Security considerations

### 13.1 Registration is not endorsement

Permissionless registration allows malicious and unreliable operators. Locked
collateral makes registrations costly but does not establish honesty. Clients
must independently validate quotes, transactions, endpoints, and keys.

### 13.2 Sybil resistance

The minimum collateral should make mass registration economically meaningful.
One actor can still create multiple sufficiently collateralized identities, so
wallets MUST NOT assume that operator IDs represent independent entities.

### 13.3 Key rotation

Changing a quote public key MUST be owner-authorized and observable on-chain.
Clients MUST identify the key version or block height used for verification and
MUST NOT silently accept a metadata-only key change.

### 13.4 Endpoint substitution

An attacker controlling metadata hosting could substitute an API endpoint.
Hash verification prevents undetected modification but does not prove that the
owner safely operates the endpoint. Clients SHOULD require HTTPS for ordinary
web endpoints and apply normal TLS validation.

### 13.5 Stale advertisements

Heartbeats prove only that the owner updated registry state. They do not prove
that the advertised API works or has sponsorship capacity. Wallets SHOULD use
short request timeouts and safe fallback behavior.

### 13.6 Denial of service

Unbounded registry iteration is unsafe. The contract and indexers MUST support
bounded or paginated discovery. Metadata size, capability counts, protocol
version counts, and update frequency SHOULD be bounded.

## 14. Events and read-only interface

The contract SHOULD emit machine-readable events for:

- operator registration;
- activation and deactivation;
- owner, key, metadata, capability, and pricing updates;
- heartbeat acceptance;
- withdrawal request; and
- withdrawal finalization.

The contract SHOULD expose read-only functions that support:

- lookup by operator ID;
- lookup by owner principal;
- pagination over operator IDs;
- status and heartbeat inspection; and
- retrieval of registry constants such as collateral and withdrawal delay.

Function signatures and Clarity types remain to be defined in the registry
contract specification. This document MUST NOT be used to infer an ABI.

## 15. Version 1 implementation scope

The minimum implementation includes:

- permissionless operator registration;
- collateral locking and delayed withdrawal;
- activation and deactivation;
- owner-authorized heartbeats;
- metadata URI and hash publication;
- advertised pricing and capacity;
- capability and protocol-version publication; and
- bounded queries for active operators.

The following features are deferred:

- protocol-defined reputation;
- slashing and dispute adjudication;
- watcher registration and rewards;
- randomized relay assignment;
- governance and a protocol treasury;
- operator auctions; and
- automatic verification of sponsored transaction outcomes.

## 16. Future watcher network

A future specification may define permissionless watchers that verify objective
events, including whether an accepted quote was fulfilled, a transaction was
sponsored, and reimbursement matched the signed authorization.

Such a system requires independently specified evidence, challenge periods,
report deduplication, rewards, penalties, and appeal rules. The registry
contract MUST NOT slash an operator or reward a watcher until those rules are
defined and implemented. Watcher reports alone are not sufficient evidence.

## 17. Open issues

The following values and formats must be resolved before implementation:

1. minimum collateral and whether it may change;
2. exact withdrawal delay in blocks;
3. heartbeat window and stale-record behavior;
4. metadata canonicalization and hash algorithm;
5. bounded Clarity types for versions, capabilities, URIs, and pricing;
6. ownership-transfer and quote-key-rotation procedures;
7. whether one owner may register multiple operators; and
8. pagination and event schemas.
