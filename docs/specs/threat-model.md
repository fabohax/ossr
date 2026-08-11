# OSSR PoC Threat Model

## Status

- **Protocol:** Open Stacks Sponsor Relay (OSSR)
- **Threat-model version:** 1
- **Status:** Draft
- **Target environment:** Stacks testnet
- **Assessed scope:** Single-action, single-operator sponsored sBTC transfer PoC
- **Last updated:** August 1, 2026

## 1. Purpose

This document identifies security threats to the OSSR proof of concept, ranks
their risk, assigns required controls, and defines the evidence needed before a
public testnet pilot.

The PoC allows a user with sBTC and no STX to submit an origin-signed adapter
call to a relay. The relay validates the transaction, pays the Stacks network
fee in STX, broadcasts it, and receives an atomic sBTC reimbursement through a
pinned Clarity adapter.

This model is specific to:

- one public Rust relay;
- one active sponsor account;
- one PostgreSQL database;
- separate quote and sponsor keys;
- one allowlisted `sbtc-transfer` action;
- one testnet Clarity adapter;
- the canonical testnet sBTC contract;
- a TypeScript client SDK and demo CLI; and
- relay-controlled broadcast.

This document does not claim that the PoC is safe for mainnet funds.

## 2. Related specifications

The following documents are part of the assessed design:

- [Quote format](quote-format.md)
- [Relay HTTP API](relay-api.md)
- [Clarity adapter](clarity-adapter.md)
- [Architecture](../ARCHITECTURE.md)
- [Development plan](../DEVELOPMENT.md)
- [ADR 0001: Rust relay](../adr/0001-use-rust-for-the-relay.md)
- [ADR 0002: PostgreSQL](../adr/0002-use-postgresql-for-durable-state.md)

If implementation behavior differs from these documents, the difference is an
unassessed change and MUST receive threat-model review.

## 3. Method

### 3.1 Approach

The model uses data-flow and trust-boundary analysis, supplemented by STRIDE-
style categories:

- spoofing;
- tampering;
- repudiation;
- information disclosure;
- denial of service; and
- elevation of privilege.

Blockchain-specific threats such as replay, nonce races, reorganization,
simulation mismatch, fee griefing, and key compromise are considered directly.

### 3.2 Risk scoring

Each threat receives a likelihood and impact score from 1 to 5.

| Score | Likelihood |
|---:|---|
| 1 | Requires exceptional access or conditions; not expected during PoC |
| 2 | Difficult but credible |
| 3 | Practical with skill, timing, or moderate access |
| 4 | Straightforward for an internet attacker or faulty operator process |
| 5 | Expected under ordinary hostile traffic or routine failure |

| Score | Impact |
|---:|---|
| 1 | Negligible diagnostic or temporary local effect |
| 2 | Limited request failure or small testnet operational loss |
| 3 | Sustained service degradation, privacy leak, or recoverable state error |
| 4 | Sponsor fund loss, user-intent violation, durable nonce outage, or protocol-invalid settlement |
| 5 | Sponsor-key compromise, arbitrary sponsor spending, unauthorized user asset movement, or systemic integrity failure |

Risk score is:

```text
risk = likelihood * impact
```

| Score | Rating | Required disposition |
|---:|---|---|
| 1–4 | Low | Track; control when inexpensive |
| 5–9 | Medium | Mitigate or explicitly accept before public pilot |
| 10–15 | High | Mitigation and automated verification required |
| 16–25 | Critical | Blocks public pilot until reduced |

Impact is scored against the security properties the PoC is intended to prove,
not merely the market value of testnet assets. A flaw that would violate user
intent or enable arbitrary sponsor signing remains high impact even on testnet.

### 3.3 Status

| Status | Meaning |
|---|---|
| `Open` | Required control or evidence is incomplete |
| `Mitigated` | Required controls and verification evidence exist |
| `Accepted` | Residual risk is explicitly accepted for the PoC |
| `Transferred` | An external dependency owns part of the risk, with local checks retained |

No threat becomes `Mitigated` solely because it is documented.

## 4. Security objectives

### 4.1 User safety

The system MUST preserve these user properties:

- The relay cannot change the origin-authorized contract, function, recipient,
  amount, sponsor fee, quote ID, expiry, or memo.
- The origin's sBTC outflow is exactly `amount + sponsor-fee` on success.
- The recipient receives exactly `amount` sats.
- The actual transaction sponsor receives exactly `sponsor-fee` sats.
- A failed or aborted transaction transfers no sBTC.
- The user never provides a private key or seed phrase to the relay.
- The user does not need STX before or after a successful transfer.

### 4.2 Sponsor safety

The system MUST preserve these sponsor properties:

- The sponsor key signs only a fully decoded, allowlisted, simulated transaction.
- The sponsor STX fee never exceeds signed quote and operator-policy limits.
- A quote produces at most one sponsor-signed transaction.
- A sponsor nonce is assigned to at most one distinct signed transaction.
- Exact sponsor-signed bytes survive crashes and ambiguous broadcasts.
- The quote key cannot spend sponsor STX.
- Loss is bounded by configured per-transaction, daily, and wallet-balance limits.

### 4.3 Protocol integrity

- Quote signatures are deterministic and domain-separated.
- Quote, transaction, adapter arguments, and database state remain bound.
- Public status never reports an aborted transaction as successful.
- Configuration identifies one network, sponsor, adapter, and sBTC contract.
- Unsupported transactions fail closed.
- Audit evidence can explain every issued quote, signature, nonce, broadcast,
  and terminal state without exposing secrets.

### 4.4 Availability and privacy

- Untrusted requests cannot consume resources without explicit bounds.
- Dependency failure disables unsafe work rather than bypassing validation.
- Logs, traces, metrics, errors, and health responses do not disclose secrets.
- Collection and retention of principals, IP addresses, and transaction intent
  are minimized and documented.

## 5. Assets

| Asset | Security property | Consequence of compromise |
|---|---|---|
| Sponsor private key | Confidentiality and constrained use | Theft of sponsor STX; arbitrary sponsor signatures |
| Sponsor STX balance | Integrity and availability | Direct loss or inability to sponsor |
| Sponsor nonce sequence | Uniqueness and ordering | Conflicts, pinning, dropped transactions, outage |
| Quote private key | Confidentiality and integrity | Forged relay offers and policy impersonation |
| Quote public-key metadata | Authenticity | Client accepts attacker quote key |
| User origin signature | Integrity and scope | Unauthorized or modified user action |
| User sBTC | Exact authorized movement | Excessive or redirected outflow |
| Signed quote | Integrity, freshness, single use | Fee manipulation, replay, wrong action or asset |
| Origin-signed bytes | Integrity and canonical interpretation | Relay sponsors another transaction |
| Sponsor-signed bytes | Integrity and durability | Double-signing or inability to reconcile broadcast |
| PostgreSQL state | Integrity, confidentiality, availability | Replay, nonce collision, privacy leak, status corruption |
| Adapter source/deployment | Authenticity and immutability | Incorrect settlement or malicious token call |
| sBTC dependency identity | Authenticity | Transfer of another asset or malicious external call |
| Relay policy/configuration | Integrity | Excessive amounts, fees, or unsafe dependencies |
| Simulation and chain state | Freshness and authenticity | Signing a transaction likely to abort or use wrong nonce |
| Logs and metrics | Confidentiality and integrity | Secret/privacy leak or hidden attack |
| Service availability | Availability | Users cannot obtain sponsorship or status |

## 6. Actors

### 6.1 Legitimate actors

- User or wallet constructing and origin-signing the transaction.
- Relay operator maintaining policy, sponsor funds, and service infrastructure.
- Sponsor signer authorizing the STX fee.
- Quote signer authorizing relay offers.
- Stacks testnet nodes, API providers, miners, and indexers.
- Canonical sBTC contracts and their maintainers.

### 6.2 Threat actors

- Anonymous internet client sending malformed or expensive requests.
- Malicious user attempting to spend sponsor STX without valid reimbursement.
- Malicious relay operator attempting to change user intent or collect excess
  sBTC.
- Attacker with database credentials or network access.
- Attacker with quote-key access.
- Attacker with sponsor-key access.
- Compromised dependency, container image, build runner, package registry, or
  upstream Stacks API.
- Another process or relay instance accidentally using the same sponsor key.
- Honest software with a crash, race, stale cache, serialization difference, or
  configuration mistake.

### 6.3 Capabilities assumed for public attackers

An unauthenticated attacker can:

- call all public API endpoints repeatedly and concurrently;
- choose arbitrary request bytes within network limits;
- create Stacks accounts and obtain testnet assets;
- request many valid quotes and abandon them;
- submit transactions with arbitrary serialization, signatures, nonces,
  payloads, post-conditions, and fees;
- replay observed quotes and requests;
- submit one intent to several relays or nodes;
- observe public transactions, contract events, and relay metadata; and
- time requests around blocks, expiries, dependency failures, and restarts.

The attacker is not assumed able to break SHA-256, secp256k1, C32Check, TLS, or
Stacks consensus cryptography.

## 7. Assumptions and dependencies

The PoC relies on these assumptions:

- Stacks origin and sponsor signature verification is correct.
- Clarity transaction execution and post-condition enforcement are atomic and
  consensus-correct.
- The pinned canonical sBTC contract implements the reviewed `transfer`
  behavior.
- The origin transaction nonce prevents the same origin transaction from being
  confirmed twice.
- PostgreSQL unique constraints, transactions, row locks, and advisory locks
  behave according to the pinned supported version.
- The operating system provides cryptographically secure randomness.
- TLS termination and trusted-proxy configuration are correct.
- At least one configured Stacks API provides sufficiently fresh and correct
  data during normal operation.
- The operator protects deployment and database credentials from public access.

An assumption is not a control. Where feasible, the relay MUST verify it at
startup, at signing time, or through independent test vectors.

## 8. Out of scope and prohibited deployment

This assessment does not cover:

- mainnet deployment or assets with real economic value;
- HSM, KMS, remote-signer, or multisignature operation;
- several sponsor wallets;
- several active relay processes signing concurrently;
- automatic fee bumping or nonce-gap repair;
- multi-operator discovery, reputation, bonding, or slashing;
- cross-relay replay coordination;
- arbitrary application adapters;
- sBTC withdrawals;
- batching, the OSSR vault, or off-chain payment intents;
- production treasury rebalancing;
- privileged operator dashboards; or
- compromise of Stacks consensus or the canonical sBTC signer system.

The PoC MUST refuse mainnet startup. Passing this threat model MUST NOT be cited
as authorization for mainnet deployment.

## 9. System and trust boundaries

### 9.1 Data-flow overview

```text
┌──────────────────────── Untrusted user environment ────────────────────────┐
│ Wallet / TypeScript SDK                                                    │
│   builds intent, validates quote, adds post-condition, signs origin        │
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ TB-1: public HTTPS / hostile input
                                ▼
┌──────────────────────────── Relay trust domain ────────────────────────────┐
│ Reverse proxy → Rust HTTP API → parser → quote/transaction validator       │
│                                      │                                     │
│                             policy + state machine                         │
│                                      │                                     │
│                 ┌────────────────────┼────────────────────┐                │
│                 ▼                    ▼                    ▼                │
│           quote signer        sponsor signer        status worker          │
│              TB-4                  TB-5                   │                │
└──────────────┬──────────────────────┬─────────────────────┼────────────────┘
               │ TB-2                 │                     │ TB-3
               ▼                      │                     ▼
        PostgreSQL                    │             Stacks API / node(s)
                                      │                     │
                                      └─────────────────────┘
                                                broadcast/simulation
                                                         │
                                                         ▼
                                             Stacks testnet execution
                                                         │ TB-6
                                                         ▼
                                     OSSR adapter → canonical sBTC contract
```

### 9.2 Trust-boundary table

| ID | Boundary | Trust decision | Primary threats |
|---|---|---|---|
| `TB-1` | Client to public relay | All input is hostile | Parser abuse, transaction substitution, replay, DoS |
| `TB-2` | Relay to PostgreSQL | Authenticated but compromise is possible | State tampering, replay, nonce collision, disclosure |
| `TB-3` | Relay to Stacks APIs | Responses may be stale, inconsistent, or malicious | Simulation mismatch, wrong nonce/fee/status, SSRF |
| `TB-4` | Relay to quote signer | Narrow operation; key never leaves signer | Quote forgery, key exfiltration, signing confusion |
| `TB-5` | Relay to sponsor signer | Highest-risk internal boundary | Arbitrary signing, key theft, duplicate nonce |
| `TB-6` | Adapter to sBTC contract | Only exact pinned principal/code profile is trusted | Dependency replacement, changed transfer semantics |
| `TB-7` | Build/deploy pipeline to runtime | Artifacts and configuration require provenance | Supply-chain compromise, wrong network/dependency |
| `TB-8` | Operator to runtime controls | Operator is privileged but fallible | Misconfiguration, secret exposure, unsafe override |

## 10. Top-level risk register

Scores are pre-control risk. Status remains `Open` until implementation evidence
exists.

| ID | Threat | L | I | Score | Rating | Required control owner | Status |
|---|---|---:|---:|---:|---|---|---|
| `T01` | Sponsor signs a substituted or partially validated transaction | 4 | 5 | 20 | Critical | Validator | Open |
| `T02` | Origin signature or sponsored-authorization validation bypass | 3 | 5 | 15 | High | Codec/validator | Open |
| `T03` | Missing or permissive post-condition permits excess user outflow | 3 | 5 | 15 | High | SDK/validator | Open |
| `T04` | Sponsor private key is stolen or exposed | 3 | 5 | 15 | High | Signer/operator | Open |
| `T05` | Quote key compromise enables forged offers | 3 | 4 | 12 | High | Quote signer/operator | Open |
| `T06` | Quote replay or idempotency failure creates multiple signatures | 4 | 4 | 16 | Critical | Repository/state machine | Open |
| `T07` | Sponsor nonce collision across concurrent requests/processes | 4 | 5 | 20 | Critical | Nonce coordinator | Open |
| `T08` | Crash after signing loses bytes and causes unsafe replacement | 3 | 5 | 15 | High | State machine/repository | Open |
| `T09` | Ambiguous broadcast leads to signing replacement bytes | 3 | 5 | 15 | High | Broadcaster/reconciler | Open |
| `T10` | Stale or malicious Stacks API causes unsafe simulation/nonce view | 4 | 4 | 16 | Critical | Stacks gateway | Open |
| `T11` | State changes after simulation cause abort and sponsor STX loss | 4 | 3 | 12 | High | Policy/accepted risk | Open |
| `T12` | Attacker manipulates fee estimation or pricing | 3 | 4 | 12 | High | Quote engine/policy | Open |
| `T13` | API resource exhaustion consumes CPU, memory, DB, or simulation | 5 | 4 | 20 | Critical | HTTP/API/operator | Open |
| `T14` | Malformed transaction exploits parser discrepancy or panic | 4 | 5 | 20 | Critical | Codec/validator | Open |
| `T15` | Database tampering or credential compromise corrupts safety state | 3 | 5 | 15 | High | Operator/repository | Open |
| `T16` | Advisory-lock misuse or collision defeats nonce serialization | 3 | 5 | 15 | High | Repository | Open |
| `T17` | SSRF or unsafe upstream configuration reaches internal services | 3 | 4 | 12 | High | Stacks gateway/operator | Open |
| `T18` | Dependency or build-pipeline compromise inserts malicious code | 3 | 5 | 15 | High | Maintainers/CI | Open |
| `T19` | Relay metadata/TLS spoof causes client to trust attacker quote key | 3 | 5 | 15 | High | SDK/operator | Open |
| `T20` | Wrong adapter or sBTC deployment is configured or deployed | 3 | 5 | 15 | High | Deployment/startup | Open |
| `T21` | Secrets or user intent leak through logs, metrics, errors, backups | 4 | 4 | 16 | Critical | Operator/observability | Open |
| `T22` | Cross-relay or external broadcast race consumes origin intent | 3 | 3 | 9 | Medium | Client/accepted risk | Open |
| `T23` | Pending transaction pins sponsor nonce and halts service | 4 | 3 | 12 | High | Nonce coordinator/operator | Open |
| `T24` | Malicious relay censors, misprices, or withholds status | 3 | 3 | 9 | Medium | Client/transparency | Open |
| `T25` | Chain reorganization or inconsistent indexer corrupts status | 3 | 3 | 9 | Medium | Status worker | Open |
| `T26` | Contract event spoof or status-mapping bug reports false success | 3 | 4 | 12 | High | Indexer/status worker | Open |
| `T27` | Unsafe configuration or emergency-control bypass enables signing | 3 | 5 | 15 | High | Startup/operator | Open |
| `T28` | Backup/restore rolls state backward and permits replay | 2 | 5 | 10 | High | Operator/repository | Open |
| `T29` | Compromised SDK or wallet deceives the user or leaks origin keys | 3 | 5 | 15 | High | SDK/wallet | Open |

## 11. Detailed threats and controls

### T01: Transaction substitution or incomplete validation

**Scenario:** A client supplies serialized bytes whose outer fields appear to
match a quote but whose decoded payload, authorization, post-conditions, network,
or trailing bytes authorize another action. A buggy relay validates JSON or a
subset of decoded fields and signs it.

**Impact:** The sponsor pays for an unapproved action; a vulnerable adapter path
could move user or third-party assets.

**Required controls:**

- Treat serialized transaction bytes as the only transaction input of record.
- Fully deserialize using one pinned canonical codec.
- Reject trailing bytes, unknown payloads, non-canonical encodings, unsupported
  authorization forms, and ambiguous post-conditions.
- Verify network, chain ID, sponsored authorization, origin signature, origin
  principal and nonce, exact adapter principal, function, argument count/types/
  values, quote argument hash, anchor/post-condition modes, and fee bounds.
- Construct a typed validated object that the signer accepts; the signer MUST
  NOT accept raw client bytes plus independent scalar parameters.
- Re-serialize and compare canonical bytes where supported.

**Evidence:** Golden cross-language fixtures, mutation tests for every field,
fuzzing corpus, and an integration test proving sponsor addition does not change
the origin-authorized payload.

### T02: Origin-signature validation bypass

**Scenario:** The relay accepts an invalid, wrong-network, wrong-sighash, or
partially signed origin authorization and appends a sponsor signature.

**Required controls:**

- Verify the exact origin signature over the transaction's origin sighash.
- Derive the origin principal from authorization data and compare it to quote
  and request state.
- Reject unsupported multisig or hash-mode variants in version 1.
- Validate against Stacks Core and `@stacks/transactions` fixtures.
- Never rely on simulation alone as proof of signature validity.

**Evidence:** Positive and negative signature vectors, modified-signature tests,
wrong-chain tests, and the ADR 0001 Rust compatibility gate.

### T03: Post-condition bypass or excess user outflow

**Scenario:** The transaction uses `Allow`, `LessEqual`, the wrong asset or
principal, duplicate conditions, or no condition. A defective or replaced
adapter could then transfer more sBTC than displayed.

**Required controls:**

- SDK builds `Deny` mode and exactly one `Equal` fungible-token condition.
- Condition binds the origin, canonical testnet sBTC asset, and exact
  `amount + sponsor-fee` using checked arithmetic.
- Relay independently parses and verifies the entire condition list.
- Contract/function allowlist and pinned code hash reduce adapter substitution.

**Evidence:** Transaction-level abort tests and relay rejection tests for every
invalid form listed in `clarity-adapter.md`.

### T04: Sponsor-key compromise

**Scenario:** A key is committed, logged, read from process inspection, stolen
from a writable secret mount, exposed by a panic, or accessed through a broad
signer API.

**Required controls:**

- Testnet-only, low-balance sponsor account with no other role.
- Narrow signer interface accepting only typed validated transactions.
- Secret injection at runtime through a read-only mechanism excluded from Git.
- Redacted secret types and no serialization/`Debug` of private material.
- Separate Unix user/container, minimal filesystem permissions, no shell or
  debug endpoint in the public service.
- Per-transaction, rolling daily, and wallet-balance spend limits enforced
  outside the signing key.
- Emergency signing disable and documented key-rotation procedure.

**Residual risk:** A local software key is accepted for testnet only. Mainnet
requires a separately assessed remote signer or HSM and operational controls.

### T05: Quote-key compromise or signing confusion

**Scenario:** An attacker issues signed quotes with excessive reimbursement,
wrong adapters, or attacker-controlled sponsor metadata, or tricks one signer
into signing the other signer's payload.

**Required controls:**

- Quote and sponsor keys are cryptographically separate.
- Quote signer accepts only the versioned SIP-018 quote domain and typed message.
- Public key identified by signed `keyId` and trusted `/v1/info` metadata.
- Key activation/retirement blocks and overlap are explicit.
- Relay revalidates its stored quote and signature before sponsor signing.
- Operator can disable the quote key without disabling status lookup.

**Residual risk:** A quote-key attacker can impersonate pricing to clients that
trust the affected relay, but cannot directly spend sponsor STX or alter a
correctly origin-signed transaction.

### T06: Quote replay and idempotency failure

**Scenario:** Concurrent or repeated submissions consume one quote more than
once, allocate several nonces, or produce different signed transactions.

**Required controls:**

- Random 32-byte quote IDs and unique database constraint.
- At most one sponsorship row per quote.
- Required `Idempotency-Key` bound to a domain-separated request hash.
- Atomic quote state transition under row lock.
- Same key/same body returns stored result; same key/different body fails.
- Same quote/different body fails.
- Once signed bytes exist, quote remains consumed permanently.
- Relay-controlled broadcast; never return completed bytes to clients.

**Evidence:** High-concurrency tests across multiple connections/processes,
crash injection at each transition, and unique-constraint assertions.

### T07 and T16: Sponsor nonce collision or lock failure

**Scenario:** Two tasks or processes read the same chain nonce and both sign
different transactions with it. A code path omits the advisory lock, derives a
different key, or suffers a lock-key collision.

**Required controls:**

- Exactly one active signing worker/process for the PoC.
- Transaction-scoped PostgreSQL advisory lock derived by one versioned function
  from the complete sponsor principal.
- `SELECT ... FOR UPDATE` on the sponsor-account row.
- Unique `(sponsor_principal, sponsor_nonce)` database constraint.
- Every reservation path calls one repository operation; no alternate SQL path.
- Reconcile confirmed, mempool, and durable reservations before allocation.
- Lock acquisition and transaction statement timeouts.
- Test lock-key derivation for stability and representative collisions.

PostgreSQL advisory locks are cooperative: the database does not force all code
paths to use them. The unique constraint is an independent final barrier.

**Evidence:** Multi-connection stress test, accidental second-process test,
property test for nonce uniqueness, and migration/schema inspection.

### T08 and T09: Crash or ambiguous broadcast after signing

**Scenario:** The process signs, crashes before persisting bytes, times out on
broadcast, and later signs replacement bytes or reuses the quote/nonce.

**Required controls:**

- Durable state machine distinguishes reserved, signed, broadcast, and observed
  states.
- Exact sponsor-signed bytes and txid become immutable once recorded.
- Signer request has a durable operation identifier.
- After any possible signature, reconciliation fails closed until the exact
  signed bytes are known or operator review completes.
- Broadcast retries use the same bytes only.
- Query by txid before classifying an ambiguous response.
- Startup reconciliation runs before readiness or signing is enabled.
- Never infer failure solely from client disconnect or HTTP timeout.

**Evidence:** Deterministic fault injection before/after reservation, signing,
persistence, send, and response handling.

**Design blocker:** The persistence/state-machine specification MUST resolve
the exact sign-versus-persist crash window before implementation of the sponsor
coordinator is accepted.

### T10: Stale, inconsistent, or malicious Stacks API

**Scenario:** An API returns a stale block height, incorrect balance/nonce,
false simulation success, manipulated fee estimate, or false transaction state.

**Required controls:**

- Fixed configured HTTPS endpoints; never accept request-supplied URLs.
- Validate network and chain identity at startup and periodically.
- Primary and fallback providers with explicit health and freshness checks.
- Bound acceptable tip lag and reject signing when freshness is unknown.
- Cross-check critical nonce/tip data when providers disagree.
- Treat malformed or internally inconsistent responses as errors.
- Pin response size, schema, timeouts, redirect policy, and connection limits.
- Status confirmation requires matching txid, adapter principal, execution
  result, and expected event/asset transfers.

**Residual risk:** Multiple providers can share the same underlying faulty data.
The PoC may stop rather than sponsor during disagreement.

### T11: State change after simulation and fee griefing

**Scenario:** A transaction simulates successfully, then origin balance/nonce,
sBTC lock state, contract state, or chain tip changes before execution. The call
aborts; sponsor pays STX but receives no sBTC.

**Required controls:**

- One deterministic, allowlisted transfer action.
- Simulation immediately before nonce reservation/signing.
- Short block-height quote lifetime.
- Check current available sBTC balance and origin nonce.
- Limit amount, execution cost, STX fee, and pending age.
- Price a failed-transaction reserve into policy.
- Record every abort and realized sponsor loss.
- Circuit-break on elevated abort rate or loss budget.

**Residual risk:** Accepted for the testnet PoC. Simulation cannot guarantee
future execution because chain state can change.

### T12: Fee or exchange-rate manipulation

**Scenario:** A compromised or stale price source, integer/rounding error, or
malicious fee-estimation response causes excessive user fees or sponsor losses.

**Required controls:**

- Fixed deterministic testnet conversion rate is preferred for reproducibility.
- Publish policy version, rate inputs, margins, and maximums.
- Use integer arithmetic with explicit rounding direction and checked bounds.
- Signed quote contains exact sponsor fee and maximum network fee.
- Client checks fee against its requested maximum.
- Relay never signs an STX fee above quote or operator limits.
- Circuit-break on missing, stale, negative, zero, or outlier price data.

**Residual risk:** The PoC demonstrates mechanics, not profitable market making.

### T13: Resource exhaustion and economic denial of service

**Scenario:** An attacker creates many quotes, sends oversized/malformed
transactions, occupies simulation slots, fills PostgreSQL, holds locks, or
forces paid upstream calls and logs.

**Required controls:**

- Reverse-proxy and application body limits before decoding.
- Bounded JSON depth, strings, hex, transaction bytes, and upstream responses.
- Per-IP and per-origin rate limits using trusted proxy configuration.
- Separate tighter limits for quote, simulation, and sponsorship flows.
- Bounded queues, concurrency semaphores, database pool, memory, CPU, file
  descriptors, and request/upstream/statement/lock timeouts.
- Reject malformed/expired requests before simulation.
- Do not reserve sponsor nonce at quote time.
- Quote retention and expiry cleanup.
- Spend and failure budgets with emergency circuit breakers.
- Metrics use bounded labels and logs use sampling where safe.

**Evidence:** Load tests, oversized bodies, slow clients, quote floods,
simulation floods, database pool exhaustion, and recovery tests.

### T14: Parser differential, panic, or unsafe numeric conversion

**Scenario:** Rust and TypeScript interpret the same quote or transaction bytes
differently, malformed input triggers a panic, or a large integer wraps/truncates.

**Required controls:**

- Pinned Stacks codec and no custom cryptographic primitives.
- Decimal protocol values parsed directly to checked integer types; never via
  floating point.
- Reject duplicate JSON keys, trailing bytes, non-canonical values, and unknown
  variants.
- Cross-language golden binary/JSON fixtures.
- Coverage-guided fuzzing of JSON, Clarity values, transaction decoder, and
  state transitions.
- No `unwrap`, `expect`, unchecked indexing, or panic on untrusted input paths.
- Process-level panic abort/restart policy does not mark reserved state reusable.

### T15: Database compromise or state tampering

**Scenario:** An attacker reads private intent data, marks quotes unused, changes
nonces/fees/status, deletes signed bytes, or modifies migrations.

**Required controls:**

- PostgreSQL is on a private network and not publicly exposed.
- Dedicated least-privilege runtime role; separate migration role.
- TLS where traffic leaves one trusted host boundary.
- Strong rotated credentials supplied at runtime.
- Schema constraints enforce quote, request-hash, and nonce uniqueness.
- Signed bytes become immutable by application and database permissions where
  practical.
- Append-only chain-event/audit history with restricted update/delete rights.
- Encrypted, access-controlled backups and restore testing.
- Alert on migration/version mismatch and unexpected state rewinds.

**Residual risk:** A fully privileged database attacker can deny service and
corrupt off-chain history. The origin signature and on-chain transaction remain
independent evidence of user intent.

### T17: Server-side request forgery

**Scenario:** Attacker-controlled input influences a Stacks API URL, redirect,
webhook, pricing endpoint, or metadata fetch and reaches internal/cloud control
services.

**Required controls:**

- No request field contains an upstream URL.
- Upstream origins are startup configuration from an allowlist.
- HTTPS required outside loopback; redirects disabled or tightly constrained.
- Resolve and reject unexpected loopback, link-local, private, or Unix-socket
  destinations when external endpoints are configured.
- Separate clients and allowlists for Stacks API and any future price provider.
- Outbound network policy permits only required destinations.

### T18: Software supply-chain compromise

**Scenario:** A malicious Rust crate, npm package, Git dependency, container
base image, CI action, or build runner exfiltrates keys or alters validation.

**Required controls:**

- Commit `Cargo.lock` and package lockfile.
- Pin Git dependencies to full commit hashes and CI actions to immutable
  revisions.
- Minimize dependencies and features; forbid unreviewed crypto/codec code.
- Run license, vulnerability, provenance, and dependency-diff review.
- Reproducible or independently verifiable release build where practical.
- Generate SBOM and record source commit/image digest for pilot deployment.
- Separate build from runtime secrets; CI never receives sponsor keys.
- Scan final image and run as non-root with read-only filesystem where possible.
- Protect branch/release workflows with review.

NIST SSDF practices apply to preparation, protected software, secure
production, and vulnerability response; documentation alone does not replace
repository enforcement.

### T19: Relay metadata, DNS, or TLS spoofing

**Scenario:** A client fetches `/v1/info` from an attacker and trusts the quote
public key delivered by the same connection, allowing forged quotes.

**Required controls:**

- Client starts from a user/application-configured HTTPS relay origin.
- Normal TLS certificate and hostname validation; no insecure bypass.
- Relay identity, sponsor, network, adapter, sBTC contract, and quote key are
  compared to trusted configuration or an independently authenticated registry.
- A quote public key is not trusted solely because it accompanies the quote.
- Key rotations require authenticated metadata refresh and activation blocks.
- Demo instructions display the relay host and sponsor identity before use.

### T20: Wrong contract or dependency deployment

**Scenario:** The relay points to an attacker adapter, wrong network deployment,
old sBTC contract, wrong asset name, or code with altered limits/errors.

**Required controls:**

- Testnet-only check in adapter and relay startup.
- Exact adapter and sBTC principals, asset name, Clarity version, source hash,
  and limits in deployment manifest and policy.
- Inspect Clarinet principal remapping before deployment.
- Compare on-chain source/code hash to reviewed artifact.
- Startup refuses any mismatch.
- Quote signs adapter and reimbursement-asset identities.
- Client independently allowlists the same identities.

### T21: Secret and privacy leakage

**Scenario:** Private keys, full environment, transactions, IP addresses,
origins, recipients, memos, database URLs, or upstream credentials appear in
logs, metrics, errors, health checks, traces, backups, or crash dumps.

**Required controls:**

- Data inventory and documented retention/deletion schedule.
- Secret wrappers with redacted formatting.
- Allowlist logging fields; never log raw request body or complete transaction.
- No txid, principal, quote ID, IP, request ID, or error text as metric labels.
- Safe public error codes and health vocabulary.
- Disable core dumps or protect them as secrets.
- Encrypt and restrict backups; test deletion.
- Truncate/hash IP data only when abuse controls require correlation.
- Memo omitted from OSSR event and application logs.

**Residual risk:** Stacks transaction arguments and asset movements are public
on-chain; OSSR cannot make the transfer itself private.

### T22: Cross-relay or external broadcast race

**Scenario:** The user submits the same origin-signed transaction to multiple
relays. Different sponsors complete competing transactions with the same origin
nonce; one confirms and others may be rejected or pay no fee if never included.

**Required controls:**

- Quote is bound to relay and sponsor identity.
- SDK submits one quote/transaction to one relay and warns against duplication.
- Short quote reservation and relay-controlled broadcast.
- Status and errors distinguish origin nonce conflict.

**Residual risk:** No cross-relay coordination exists in version 1. This is
accepted because the PoC operates one relay. Multi-relay deployment requires a
new protocol assessment.

### T23: Sponsor nonce pinning and mempool congestion

**Scenario:** A valid sponsored transaction remains pending or is dropped,
blocking later sequential sponsor nonces.

**Required controls:**

- Limit number and maximum age of pending sponsor transactions.
- Stop new signing when the pending chain or nonce uncertainty exceeds policy.
- Monitor confirmed/mempool/local nonce divergence.
- Reconcile on startup and continuously.
- Alert operator with an explicit runbook.
- No automatic fee bumping or nonce-gap repair in version 1.

**Residual risk:** Availability can halt until the mempool resolves or the
operator intervenes. Safety takes precedence over throughput.

### T24: Malicious or censoring relay

**Scenario:** The operator refuses users, returns unfavorable prices, withholds
status, logs intent, or selectively delays broadcast.

**Controls:**

- User verifies signed fee and intent before origin signing.
- Origin post-condition bounds sBTC outflow.
- Relay never receives user private key or custody of transfer amount.
- Public policy/version, testnet transaction, and event provide evidence.
- User may abandon an unsigned/unsubmitted quote without cost.

**Residual risk:** Version 1 has one operator and provides no availability or
fair-pricing guarantee. Cryptography cannot force a relay to serve or broadcast.

### T25 and T26: Reorganization, event spoofing, or false status

**Scenario:** A shallow reorganization removes a transaction, an indexer returns
stale data, another contract emits a similar tuple, or the status worker treats
any `success` response as OSSR settlement.

**Required controls:**

- Match complete txid, deployed adapter principal, function, origin, sponsor,
  quote ID, execution result, and asset events.
- Treat canonical sBTC transfers as settlement evidence, not `print` alone.
- Identify event by contract principal and event discriminator.
- Record observed block identifier/height and update status on reorganization.
- Pilot UI distinguishes broadcast, pending, confirmed, aborted, and dropped.
- Define a confirmation threshold for pilot metrics; do not imply Bitcoin
  finality from initial Stacks inclusion.

### T27: Misconfiguration or unsafe administrative override

**Scenario:** Relay starts on mainnet, uses mismatched sponsor/key, accepts an
unreviewed adapter, exposes metrics/admin interfaces, or ignores emergency
disable state.

**Required controls:**

- Typed configuration with no permissive defaults for security identifiers.
- Startup validation of network/chain, sponsor derived from key, adapter, sBTC
  principal/asset, code hashes, policy limits, and migration version.
- Configuration hash exposed without secrets.
- Emergency switches default safe and are checked immediately before quote
  signing and sponsor signing.
- No public mutation/admin API in PoC.
- Metrics private or authenticated.
- Deployment canary before public quote enablement.

### T28: Backup or restore rollback

**Scenario:** PostgreSQL is restored to a point before quote consumption or
nonce reservation while the corresponding signed transaction remains in the
network, permitting duplicate work or nonce reuse.

**Required controls:**

- Restored service starts with quoting and signing disabled.
- Reconcile sponsor nonce, mempool, confirmed history, and known txids before
  readiness.
- Retain signed transaction identifiers outside short database retention where
  operationally appropriate.
- Never assume restored quote state is authoritative for already-issued IDs.
- Restore runbook requires explicit operator approval to re-enable signing.

### T29: Compromised SDK, demo client, or wallet

**Scenario:** A malicious dependency or compromised client displays the quoted
recipient and fee but asks the wallet to sign different transaction bytes,
weakens the post-condition, sends the origin key to the relay, or silently uses
an attacker relay/key.

**Required controls:**

- SDK never accepts, stores, transmits, or logs a seed phrase or private key.
- Wallet performs origin signing and SHOULD display decoded contract, function,
  recipient, amount, fee-equivalent outflow, and network.
- SDK independently verifies quote signature, trusted relay metadata, adapter,
  sBTC asset, arguments hash, expiry, and fee limit.
- SDK constructs `Deny` mode and the exact `Equal` sBTC post-condition.
- Demo client pins dependencies and lockfiles and receives the same supply-chain
  controls as the relay.
- Release artifacts and package provenance SHOULD be verifiable.
- End-to-end fixtures compare wallet-generated bytes with relay-decoded intent.
- Documentation warns users never to paste keys or seed phrases into the CLI or
  relay website.

**Residual risk:** A fully compromised wallet or user device can authorize an
arbitrary transaction as the user. This is outside the relay's ability to
prevent. The PoC minimizes its own access to wallet secrets and makes the
intended transaction independently decodable.

## 12. Abuse-case matrix

| Attacker goal | Entry point | Prevent | Detect | Recover |
|---|---|---|---|---|
| Spend sponsor STX on arbitrary call | `/v1/sponsorships` | Exact decode/allowlist/signature validation | Rejection metrics and audit code | Disable signing; inspect signer logs |
| Take excess user sBTC | SDK/adapter | Origin signature, exact post-condition, pinned adapter | On-chain asset/event reconciliation | Disable adapter policy; notify users |
| Obtain two sponsor signatures | Concurrent POSTs | Unique quote/nonce constraints and locks | Duplicate/conflict alerts | Preserve bytes; reconcile nonce |
| Forge a relay quote | Metadata/signing boundary | SIP-018, trusted key metadata, key isolation | Unknown key/policy alerts | Retire quote key; disable quotes |
| Steal sponsor key | Host/supply chain | Isolation, low balance, no secret logs | Balance/signature anomaly | Disable, rotate, fund new account |
| Drain sponsor through aborts | Valid hostile requests | Simulation, short expiry, policy budgets | Abort/loss rate | Circuit-break signing |
| Exhaust relay resources | Public API | Bounds, quotas, concurrency limits | Saturation and 429 metrics | Shed load; disable quotes/signing |
| Corrupt nonce state | Database/process race | Locks, unique constraints, one worker | Nonce divergence alert | Stop and reconcile |
| Hide successful/failed settlement | Status/indexer | Multi-field chain verification | Provider disagreement | Re-index from node/API |
| Exfiltrate user intent | Logs/backups/metrics | Data minimization and redaction | Secret/privacy scanning | Purge, rotate credentials, notify |

## 13. Security architecture requirements

### 13.1 Fail-closed rules

The relay MUST refuse new quotes and sponsorships when any of these is unknown
or inconsistent:

- network or chain ID;
- current sufficiently fresh Stacks tip;
- adapter or sBTC contract identity;
- sponsor principal derived from signer;
- quote or sponsor signer availability;
- PostgreSQL migration compatibility;
- sponsor nonce reconciliation;
- sponsor balance above reserve;
- fee estimate within bounds;
- policy/configuration hash; or
- emergency-disable state.

Status endpoints SHOULD remain available during a signing halt.

### 13.2 Separation of duties

- Quote signer and sponsor signer use separate keys.
- Runtime database role cannot run migrations.
- Public API has no deployment or treasury mutation operation.
- Client SDK never contains operator policy secrets.
- Status/indexing cannot invoke signing.
- Metrics/health paths cannot access or serialize key material.

### 13.3 Spending limits

At minimum, enforce:

- maximum network fee per transaction;
- maximum sponsor fee and transfer amount;
- maximum signed transactions per time window;
- maximum daily sponsor STX spend;
- maximum daily realized abort loss;
- minimum remaining sponsor balance; and
- maximum pending transaction count/age.

Crossing a hard limit MUST disable new sponsor signatures and alert the operator.

### 13.4 Audit record

For each sponsorship, retain enough non-secret data to reconstruct:

- quote ID, signed quote bytes/payload hash, signature, and key ID;
- idempotency request hash;
- origin-signed transaction hash and validated semantic fields;
- policy/configuration version;
- simulation tip and outcome;
- reserved sponsor nonce and selected STX fee;
- sponsor-signed bytes or their encrypted durable representation;
- txid and broadcast attempts;
- chain observations and final outcome; and
- bounded error codes and state-transition timestamps.

Audit records MUST not contain either private key.

## 14. Key lifecycle

### 14.1 Generation

- Generate quote and sponsor keys independently with a CSPRNG.
- Never derive one from the other or from a user mnemonic.
- Derive and record public identities offline before deployment.
- Fund only the testnet sponsor principal.

### 14.2 Storage and use

- Keep secrets out of Git, images, CI variables exposed to forks, command-line
  arguments, logs, and database.
- Mount/inject at runtime with least privilege.
- Load each key only in its signer component.
- Disable serialization and debug formatting.
- Zeroize transient copies where supported, without claiming guaranteed removal
  from all runtime/OS memory.

### 14.3 Rotation and revocation

- Quote-key rotation uses `keyId`, activation height, retirement height, and
  overlap through all unexpired quotes.
- Sponsor-key rotation changes sponsor principal, pauses signing, reconciles the
  old account, updates trusted metadata/policy, and requires a canary.
- Suspected compromise immediately disables the affected operation.
- Status lookup remains available during rotation.

### 14.4 Destruction

Retired test keys and secret-bearing backups MUST be deleted according to the
retention policy. Public keys, txids, and audit evidence MAY remain.

## 15. Monitoring and detection

Alert on:

- any signing request rejected by the signer boundary;
- sponsor nonce mismatch, conflict, gap, or unknown state;
- duplicate quote/idempotency constraint violations;
- signing after emergency disable;
- low sponsor balance or spend/loss budget threshold;
- increased simulation failure or on-chain abort rate;
- Stacks provider disagreement or excessive tip lag;
- database migration mismatch, lock waits, or connection exhaustion;
- unexpected adapter, sBTC principal, policy, or configuration hash;
- quote signature verification failures;
- unknown quote key IDs;
- elevated parser errors, oversized requests, 429s, or panics;
- broadcast ambiguity or old pending transactions;
- secret-scanner findings; and
- readiness transitions.

Alerts MUST use bounded labels and MUST NOT include raw transaction bytes,
private user data, or secrets.

## 16. Incident response

### 16.1 Immediate containment

For suspected sponsor-key compromise, arbitrary signing, nonce corruption,
adapter mismatch, or database rollback:

1. disable new quote issuance and sponsor signing;
2. preserve status endpoints and immutable evidence;
3. do not delete or rewrite pending transaction records;
4. record current sponsor balance, confirmed nonce, mempool state, build digest,
   configuration hash, and database state;
5. rotate affected credentials from a trusted environment;
6. reconcile all possibly signed bytes and txids; and
7. publish a testnet incident note when user-visible results are affected.

### 16.2 Recovery

Signing MAY resume only after:

- root cause is understood;
- sponsor nonce and pending transactions are reconciled;
- compromised keys/credentials are replaced;
- corrected artifacts pass regression and adversarial tests;
- deployment identity and configuration are reverified; and
- a testnet canary succeeds.

### 16.3 Evidence preservation

Preserve bounded logs, database snapshots, image/source digests, configuration
hashes, txids, and chain observations. Do not collect new secret material merely
for incident evidence.

## 17. Verification plan

### 17.1 Pre-implementation gates

- Rust Stacks transaction compatibility spike passes ADR 0001.
- Quote golden vectors exist and pass in Rust and TypeScript.
- Persistence/state-machine specification closes the sign/persist crash window.
- Database migrations encode uniqueness and state invariants.
- Adapter compiles and passes the tests in `clarity-adapter.md`.

### 17.2 Automated security testing

- Unit tests for all validation rules and state transitions.
- Property tests for fee arithmetic, quote encoding, nonce uniqueness, and
  adapter balance conservation.
- Coverage-guided fuzzing of JSON, hex, Clarity values, transaction bytes, and
  status transitions.
- Concurrency tests using PostgreSQL, never SQLite substitution.
- Fault injection around database commit, signer call, persistence, broadcast,
  and response.
- Dependency and secret scanning.
- Static analysis, compiler warnings as errors, and unsafe-code review.
- Container configuration and non-root/read-only runtime tests.

### 17.3 Manual review

- Line-by-line sponsor-signing and transaction-validation review.
- Clarity source and deployment-plan review.
- Database schema/locking review.
- Threat-model control-to-test traceability review.
- Operational secret, backup, restore, and emergency-stop rehearsal.

### 17.4 Public pilot gates

The public pilot MUST NOT begin until:

- all Critical threats are `Mitigated`;
- all High threats are mitigated or explicitly accepted with owner and reason;
- no key or secret is present in repository history or image layers;
- startup fails on wrong network, contract, sponsor, key, policy, or migration;
- concurrent replay/nonce tests pass;
- crash/broadcast reconciliation tests pass;
- rate, body, queue, timeout, and spending limits are active;
- monitoring and emergency disable have been exercised; and
- a reviewer can reproduce a zero-STX testnet transfer from documentation.

## 18. Residual risks accepted for the PoC

The following may be accepted only for public testnet with bounded balances:

| Risk | Reason | Required bound |
|---|---|---|
| State changes after simulation cause abort | Unavoidable simulation/execution race | Loss budget, short expiry, circuit breaker |
| Local software sponsor key | HSM is outside PoC | Testnet only, low balance, isolated secret |
| One operator can censor or misprice | Decentralized routing is Phase 2 | Signed visible fee; user can reject quote |
| One Stacks API may be primary | Multi-provider operation may be limited | Fallback, freshness checks, fail closed |
| Pending nonce can halt service | No fee bump/gap repair in PoC | Pending limits and manual runbook |
| Public chain reveals transfer intent | Inherent to public settlement | Off-chain data minimization |
| No on-chain quote replay map | Nonces and durable relay state already bind use | One relay, random quote IDs, idempotency |

None of these acceptances permits mainnet use.

## 19. Deferred risks requiring a new assessment

A new threat-model version is REQUIRED before adding:

- mainnet;
- multiple relays or sponsor accounts;
- horizontal signing workers;
- automatic fee bumping or nonce repair;
- remote/HSM signing;
- on-chain relay discovery;
- another reimbursement asset;
- withdrawals or arbitrary contract adapters;
- batching/vault custody;
- authenticated customer or operator accounts;
- a dashboard with mutation operations;
- webhooks or caller-supplied callback URLs; or
- treasury automation.

## 20. Review and maintenance

Review this model:

- before implementation begins;
- when any assessed specification or ADR changes;
- after the Rust compatibility spike;
- before public testnet deployment;
- after any security incident or unexpected on-chain abort;
- before adding a new dependency with access to transaction or key material; and
- at every release that changes validation, signing, nonce, persistence,
  adapter, or broadcast behavior.

Each implementation pull request affecting a listed trust boundary SHOULD cite
the relevant threat IDs and tests.

## 21. References

- [OWASP API Security Top 10, 2023](https://owasp.org/API-Security/editions/2023/en/0x10-api-security-risks/)
- [OWASP API4: Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)
- [NIST SP 800-218: Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final)
- [PostgreSQL advisory-lock functions](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS)
- [SIP-018: Signed Structured Data](https://github.com/stacksgov/sips/blob/main/sips/sip-018/sip-018-signed-structured-data.md)
- [Canonical sBTC token source](https://github.com/stacks-sbtc/sbtc/blob/main/contracts/contracts/sbtc-token.clar)
