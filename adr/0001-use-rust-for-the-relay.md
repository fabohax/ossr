# ADR 0001: Use Rust for the relay

- **Status:** Accepted
- **Date:** July 31, 2026
- **Decision owners:** OSSR maintainers

## Context

The OSSR relay accepts hostile serialized transactions, validates them against
signed quotes and policy, assigns a sponsor nonce and fee, handles sponsor
private-key operations, and broadcasts the completed transaction. Incorrect
decoding, unchecked numeric conversion, concurrency errors, or ambiguous error
handling can lose sponsor STX or violate a user's quoted intent.

The original development plan proposed TypeScript for both the relay and client
SDK. TypeScript has the strongest application-level Stacks tooling through
`@stacks/transactions`, and wallet integrations are predominantly JavaScript or
TypeScript. Rust, however, is the implementation language of Stacks Core and is
a better fit for a long-running, security-sensitive signing service.

The main Rust risk is library integration. Stacks Core contains Rust crates for
consensus types, codecs, Clarity values, and transaction behavior, but these
crates currently use early package versions and are developed primarily as
parts of the Stacks Core workspace. They do not provide the same stable,
application-focused API surface as `@stacks/transactions`.

The PoC must therefore prove Rust compatibility early instead of assuming it.

## Decision

The reference relay daemon will be implemented in stable Rust.

The client SDK and demo CLI will remain TypeScript because they integrate with
wallet-facing Stacks tooling. Protocol fixtures will be shared as language-
neutral JSON and binary files, not through shared source types.

The initial Rust stack is:

| Concern | Choice |
|---|---|
| Toolchain | Stable Rust, pinned by `rust-toolchain.toml` |
| Async runtime | Tokio |
| HTTP API | Axum |
| Middleware | Tower and `tower-http` |
| JSON | Serde and `serde_json` |
| Input validation | Strong domain types plus explicit validation |
| PostgreSQL | SQLx with compile-time checked queries where practical |
| HTTP client | Reqwest with rustls |
| Errors | `thiserror`; `anyhow` only at process/application boundaries |
| Logging and traces | `tracing` and `tracing-subscriber` |
| Metrics | Prometheus-compatible exporter |
| Property testing | `proptest` |
| Secrets | `secrecy` plus redacted `Debug` implementations |
| Packaging | Multi-stage Docker image |

The relay MUST NOT implement cryptographic primitives from scratch.

Stacks consensus serialization, sponsored-transaction decoding, origin
signature verification, sponsor signing, transaction ID calculation, and
SIP-018 encoding MUST be validated against:

1. upstream Stacks Core behavior;
2. pinned `@stacks/transactions` reference fixtures; and
3. OSSR golden vectors committed to the repository.

## PoC compatibility gate

Before building the full relay, a time-boxed technical spike MUST demonstrate
all of the following:

1. Deserialize a sponsored, origin-signed contract-call transaction generated
   by `@stacks/transactions`.
2. Recover or validate the origin authorization and compare every committed
   adapter argument.
3. Add the sponsor spending condition, nonce, STX fee, and signature without
   changing the origin-authorized payload.
4. Serialize bytes accepted by Stacks testnet or a representative devnet.
5. Produce the same transaction ID as the Stacks reference implementation.
6. Encode, sign, and verify the OSSR SIP-018 quote vectors.
7. Verify malformed and non-canonical transactions fail closed.

The spike SHOULD use pinned Stacks Core crates where their public interfaces and
licenses are acceptable. Any Git dependency MUST be pinned to a full commit
hash. A dependency and license review is REQUIRED before adopting Stacks Core
crates because their current manifests identify GPLv3 licensing.

If the gate cannot be completed within three engineering days without copying
large portions of Stacks Core or creating a custom transaction/cryptography
implementation, this ADR MUST be revisited. The fallback is a TypeScript relay
using `@stacks/transactions`, while retaining PostgreSQL and the same protocol
boundaries.

## Rationale

Rust is preferred for the relay because:

- exhaustive enums and strong domain types reduce ambiguous state handling;
- checked integer conversions suit protocol values and fee arithmetic;
- ownership and concurrency rules help isolate signer state;
- predictable resource use benefits an internet-facing daemon;
- it aligns with the Stacks Core implementation language; and
- a single compiled binary simplifies deployment.

Rust is not automatically preferable for the whole PoC. Keeping the client in
TypeScript preserves compatibility with the mature wallet and transaction
ecosystem, and the compatibility gate prevents Rust library maturity from
silently becoming a schedule risk.

## Consequences

### Positive

- The security-sensitive relay has strong compile-time guarantees.
- Signer, validator, repository, and Stacks gateway boundaries can be expressed
  as narrow Rust traits.
- The deployable service is a single binary with no Node.js runtime.
- The project can reuse or validate against Rust code from Stacks Core.

### Negative

- The relay and client use different languages.
- Protocol types cannot be shared as source code.
- Compile times and developer onboarding are heavier than TypeScript.
- Stacks Rust dependencies may require Git pinning and careful license review.
- Golden cross-language fixtures become a release requirement.

### Neutral

- Clarity contracts and Clarinet tests remain independent of the relay language.
- Rust does not eliminate the need for adversarial tests or external review.

## Rejected alternatives

### TypeScript for every component

This has the fastest initial path and the most mature Stacks application
library, but provides weaker compile-time protection around protocol states,
numeric conversions, and signer concurrency. It remains the documented
fallback if the Rust compatibility gate fails.

### Rust for the client SDK

Rejected for the PoC because wallet and browser integration would be harder and
would not help prove the sponsorship path.

### A Rust relay that delegates signing to a Node.js sidecar

Rejected because it adds a second runtime and inter-process trust boundary
without proving a necessary PoC capability.

## References

- [Stacks Core repository](https://github.com/stacks-network/stacks-core)
- [Stacks Core workspace manifest](https://github.com/stacks-network/stacks-core/blob/master/Cargo.toml)
- [`stackslib` manifest](https://github.com/stacks-network/stacks-core/blob/master/stackslib/Cargo.toml)
- [Axum documentation](https://docs.rs/axum/)
- [SIP-018](https://github.com/stacksgov/sips/blob/main/sips/sip-018/sip-018-signed-structured-data.md)
