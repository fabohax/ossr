# OSSR v0.1 PoC Roadmap

## Status

- **Project:** Open Stacks Sponsor Relay (OSSR)
- **Release:** v0.1 proof of concept
- **Status:** Planned
- **Target:** Stacks testnet
- **Schedule:** Eight implementation weeks
- **Primary action:** Sponsored sBTC transfer
- **Last updated:** August 1, 2026

## 1. Objective

OSSR v0.1 proves one end-to-end property:

> A user holding testnet sBTC and zero STX can send sBTC through an independent
> relay. The relay pays the complete Stacks network fee in STX, the recipient
> receives the requested amount, and the relay receives the exact quoted fee in
> sats as part of the same atomic transaction.

The PoC is complete only when this flow is reproducible on public Stacks
testnet from documented setup commands and its safety properties are exercised
by automated tests.

## 2. Scope

### 2.1 Included

- One Stacks network: testnet.
- One action: sBTC transfer through an allowlisted Clarity adapter.
- One independently operated relay.
- One active sponsor account and serialized signing worker.
- Signed, short-lived quotes denominated in sats.
- Origin-signed sponsored transactions.
- Complete transaction decoding and fail-closed validation.
- Transaction simulation before sponsor signing.
- STX fee estimation, sponsor nonce coordination, and relay-controlled
  broadcasting.
- PostgreSQL persistence for quotes, transactions, and nonce state.
- A Rust relay daemon.
- A minimal TypeScript client SDK and CLI demonstration.
- Docker-based local deployment and a public testnet relay.
- Structured logs, basic metrics, an operational runbook, and a pilot report.

### 2.2 Excluded

- Mainnet deployment or use with funds of value.
- Arbitrary contract calls or sponsored withdrawals.
- Reimbursement assets other than sBTC.
- Multiple relays, competitive routing, or automatic failover.
- Deployment of the on-chain operator registry.
- Reputation, collateral, slashing, watchers, or governance.
- Randomized operator assignment.
- Batched settlement, payment-intent queues, or a custody vault.
- Multiple sponsor wallets, HSM integration, or automated treasury management.
- Fee bumping and automatic nonce-gap repair.
- A production operator dashboard or wallet UI.
- A formal external security audit.

These exclusions override broader or older roadmap ideas elsewhere in the
repository for the purpose of v0.1 acceptance.

## 3. Delivery principles

1. **Prove compatibility early.** The adapter, Stacks transaction libraries,
   SIP-018 implementation, sponsored authorization, and testnet sBTC contract
   are validated before the relay architecture is expanded.
2. **Fail closed.** Missing, unknown, stale, ambiguous, or inconsistent data
   prevents sponsor signing.
3. **Sign last.** The relay decodes, validates, estimates, and simulates before
   reserving a nonce and producing a sponsor signature.
4. **Persist safety state.** Quote consumption, idempotency, transaction state,
   and sponsor nonce reservations are durable PostgreSQL operations.
5. **Use cross-language fixtures.** Rust and TypeScript share JSON, Clarity, hash,
   signature, and transaction golden vectors rather than source-language types.
6. **Keep testnet restrictions explicit.** The relay refuses mainnet startup and
   uses low-balance, isolated testnet signing keys.
7. **Measure before extending.** v0.2 work begins only after the individual
   sponsored-transaction baseline is demonstrated and reported.

## 4. Dependency order

```text
Protocol freeze
      │
      ├──> Clarity adapter ──> contract tests ──> testnet deployment
      │
      └──> golden vectors ──> Rust protocol core ──> relay pipeline
                                  │                       │
                                  └──> TypeScript SDK <───┘
                                                           │
                                                           v
                                                  end-to-end demo
                                                           │
                                                           v
                                                   public pilot
```

Work MAY proceed in parallel where the interfaces and fixtures are already
stable. No downstream milestone passes while one of its required gates is
open.

## 5. Milestone 0 — Compatibility spike

**Schedule:** Before Week 1

### Deliverables

- A minimal Clarity contract test proving access to `tx-sponsor?`.
- A locally constructed sponsor-enabled transaction with distinct origin and
  sponsor authorizations.
- Rust proof that the selected Stacks libraries can:
  - decode the complete transaction;
  - inspect origin and sponsor authorization fields;
  - construct the required hashes and signatures; and
  - preserve transaction bytes across decode and encode where required.
- TypeScript proof that the client can construct the adapter call,
  post-conditions, and origin signature.
- A documented testnet sBTC contract principal and supported Stacks epoch.
- A short compatibility report recording library versions and unresolved gaps.

### Exit gate

- [ ] The adapter can distinguish a sponsored call and bind reimbursement to
      the actual sponsor.
- [ ] A valid origin-signed transaction can be completed with a separate sponsor
      authorization.
- [ ] Rust can inspect every transaction field required by the validator.
- [ ] TypeScript and Rust produce or verify the same protocol fixture.
- [ ] No unresolved library limitation blocks the v0.1 transaction path.

If this gate fails, implementation pauses for an ADR that selects a compatible
library, isolates a small compatibility layer, or revises the unsupported
mechanism without widening PoC scope.

## 6. Milestone 1 — Protocol and atomic adapter

**Schedule:** Weeks 1–2

### Week 1: freeze the implementable protocol

- Reconcile the relay API, quote format, adapter, architecture, and threat model.
- Assign explicit protocol and schema versions.
- Resolve contract principals, function names, Clarity types, byte encodings,
  integer units, maximum lengths, and expiry semantics.
- Define the policy manifest and startup invariants.
- Create language-neutral valid and invalid golden vectors.
- Record any remaining design decisions as ADRs.

### Week 2: implement and verify the adapter

- Implement `sponsored-transfer.clar` from the adapter specification.
- Implement atomic recipient transfer and sponsor reimbursement.
- Emit the specified settlement event.
- Add Clarinet unit and property-oriented boundary tests.
- Define the exact fungible-token post-condition templates used by the client.
- Deploy the adapter to testnet and record its immutable deployment details.
- Run static analysis and a focused manual contract review.

### Deliverables

- Versioned relay API and quote specifications.
- Versioned transaction-validation policy.
- Threat model with all Critical and High risks assigned a disposition.
- Policy manifest schema.
- Cross-language protocol fixtures.
- Tested and deployed sponsored-transfer adapter.
- Post-condition construction fixtures.

### Exit gate

- [ ] A client can independently verify a quote signature and all signed fields.
- [ ] Any signed-field mutation invalidates its fixture or signature.
- [ ] Quotes bind the network, relay, sponsor, origin, action, adapter arguments,
      reimbursement asset, exact sponsor fee, maximum STX network fee, issue
      height, expiry height, policy version, and signing key.
- [ ] The adapter pays the requested amount to the recipient and the exact fee
      to `tx-sponsor?`, or both transfers revert.
- [ ] Missing sponsor, expired quote, insufficient balance, and invalid argument
      cases revert in contract tests.
- [ ] Post-conditions cap the user's total sBTC outflow.
- [ ] Contract and protocol tests pass in CI.

## 7. Milestone 2 — Reference relay and testnet flow

**Schedule:** Weeks 3–5

### Week 3: service foundation and quote path

- Create the Rust workspace and shared protocol crate.
- Implement configuration validation and mainnet startup refusal.
- Add PostgreSQL migrations for quotes, quote consumption, transactions,
  idempotency records, and sponsor nonce reservations.
- Implement health, operator metadata, quote, sponsorship, and status endpoints.
- Implement quote pricing, signing, key identification, and expiration.
- Add request bounds, timeouts, structured errors, and secret redaction.

### Week 4: validation and simulation pipeline

- Decode the complete origin-signed transaction from untrusted bytes.
- Implement every allowlist and invariant check in the relay specification.
- Verify quote binding, post-conditions, origin signature, network, adapter call,
  amounts, expiry, and maximum fee.
- Integrate transaction fee estimation and preflight simulation.
- Reject inconsistent or stale upstream responses.
- Add an accept and reject test for every validator rule.

### Week 5: signing, persistence, and broadcast

- Implement serialized sponsor nonce reservation in PostgreSQL.
- Add sponsor fee assignment and sponsor authorization signing.
- Make quote consumption and sponsorship submission idempotent.
- Implement relay-controlled broadcast and status reconciliation.
- Treat ambiguous broadcast results as an existing transaction to reconcile,
  never as permission to sign a replacement automatically.
- Package the relay and PostgreSQL with Docker Compose.
- Deploy the first public testnet instance.

### Deliverables

- Rust relay daemon and protocol core.
- Quote and policy engines.
- Fail-closed transaction validator.
- Stacks API gateway, estimator, simulator, and broadcaster.
- PostgreSQL schema and migrations.
- Sponsor nonce coordinator.
- Docker Compose deployment.
- Initial testnet deployment.

### Exit gate

- [ ] A user holding testnet sBTC and zero STX completes the sponsored transfer.
- [ ] The sponsor pays the STX fee, the recipient receives the requested sats,
      and the sponsor receives the exact quoted sats.
- [ ] Modified, expired, replayed, unsupported, over-limit, and malformed
      transactions are rejected before sponsor signing.
- [ ] A failed simulation never reaches sponsor signing.
- [ ] Concurrent requests cannot consume one quote or sponsor nonce twice.
- [ ] Repeating an idempotent request returns its stored outcome.
- [ ] A restart preserves consumed quotes, transaction state, and nonce safety.
- [ ] The complete flow runs from one documented local CLI procedure.

## 8. Milestone 3 — Client, pilot, and release evidence

**Schedule:** Weeks 6–8

### Week 6: client SDK and reproducible demo

- Implement a minimal TypeScript SDK for operator metadata, quote requests,
  quote verification, adapter-call construction, post-conditions, origin
  signing, submission, and status polling.
- Preserve all large integers as decimal strings or big integers.
- Build a CLI demonstration that exposes the exact sat-denominated cost before
  signing.
- Publish setup, funding, deployment, and demo instructions.
- Have a developer other than the author run the documented workflow.

### Week 7: adversarial testing and public pilot

- Add integration tests across the SDK, relay, PostgreSQL, adapter, and testnet
  gateway boundary.
- Add adversarial cases for mutation, replay, expiry, malformed serialization,
  fee inflation, post-condition weakening, simulation failure, concurrency,
  upstream disagreement, and log leakage.
- Expose testnet health and basic operational metrics.
- Begin a controlled pilot with at least 10 test wallets.
- Record transaction IDs, timings, outcomes, quoted fees, paid STX fees, and
  failure classifications without collecting private keys or unnecessary user
  data.

### Week 8: stabilize and publish

- Fix pilot defects without adding new protocol features.
- Complete at least 100 successful sponsored testnet transactions.
- Re-run the entire acceptance and adversarial suites from a clean environment.
- Complete the operator runbook, incident procedures, and known-limitations
  document.
- Publish the pilot report, reproducible evidence, and final demonstration.
- Tag the immutable v0.1 PoC release.

### Deliverables

- Minimal TypeScript client SDK.
- Demo CLI and end-to-end example.
- Integration and adversarial test suites.
- Public testnet relay endpoint.
- Basic metrics and operator runbook.
- Pilot dataset and report.
- Final demonstration and v0.1 release tag.

### Exit gate

- [ ] At least 100 sponsored testnet transactions confirm successfully.
- [ ] At least 10 test wallets participate.
- [ ] The primary zero-STX acceptance flow is reproducible by a third party.
- [ ] Every documented invalid-request class has a reproducible rejection test.
- [ ] Metrics report request outcomes, latency, STX costs, sBTC fees, simulation
      failures, on-chain failures, and nonce incidents.
- [ ] Deployment and operations documentation lets a second developer run a
      relay from a clean environment.
- [ ] Source, tests, specifications, deployment files, limitations, and pilot
      results are public under the repository license.

## 9. Week-by-week summary

| Week | Focus | Required output |
|---:|---|---|
| Pre-1 | Compatibility spike | Proven Rust, TypeScript, Clarity, and sponsored-transaction path |
| 1 | Protocol freeze | Versioned schemas, invariants, fixtures, and threat dispositions |
| 2 | Atomic adapter | Tested and deployed Clarity contract |
| 3 | Relay foundation | Quote service, persistence, and API skeleton |
| 4 | Safety pipeline | Complete validation, estimation, and simulation |
| 5 | Sponsorship | Durable nonce coordination and end-to-end testnet transaction |
| 6 | Client workflow | SDK, CLI, and independently reproduced demo |
| 7 | Adversarial pilot | Security cases, metrics, and pilot dataset |
| 8 | Release | 100-transaction report, runbook, demo, and v0.1 tag |

## 10. Quality gates

### 10.1 Required continuous-integration checks

- Rust formatting, linting, unit tests, and dependency audit.
- TypeScript formatting, linting, type checking, and unit tests.
- Clarinet contract checks and tests.
- PostgreSQL migration apply and rollback tests where rollback is supported.
- Cross-language golden-vector tests.
- Integration tests with isolated database state.
- Secret scanning and dependency/license review.
- Documentation link and example validation.

### 10.2 Release-blocking defects

The v0.1 release MUST NOT ship while any of the following is unresolved:

- sponsor signing can occur before complete validation and simulation;
- two requests can consume the same quote or sponsor nonce;
- a user can lose more sBTC than the displayed transfer plus quoted fee;
- reimbursement can be redirected away from the actual transaction sponsor;
- mainnet startup or non-allowlisted contract calls are possible;
- transaction mutation is not detected;
- keys, secrets, or sensitive raw request data appear in logs;
- a Critical or High threat lacks mitigation or explicit testnet-only acceptance;
  or
- the clean-environment acceptance demo cannot be reproduced.

## 11. Definition of done

OSSR v0.1 is done when all milestone gates pass and the following evidence is
published:

- [ ] Public source and open-source license.
- [ ] Versioned protocol, API, adapter, architecture, and threat specifications.
- [ ] Testnet adapter and relay deployment identifiers.
- [ ] CI results for contract, protocol, relay, client, integration, and
      adversarial tests.
- [ ] A public explorer link for the final acceptance transaction.
- [ ] Proof that the user held zero STX before and after that transaction.
- [ ] Balance evidence for the exact recipient amount and sponsor reimbursement.
- [ ] Evidence that the sponsor paid the network fee in STX.
- [ ] A 100-transaction pilot report with at least 10 participating test wallets.
- [ ] Reproducible deployment, demo, operations, and incident instructions.
- [ ] Known limitations and accepted residual risks.
- [ ] An immutable v0.1 release tag and final demonstration video.

## 12. Success metrics

The pilot report MUST include at least:

| Category | Metric |
|---|---|
| Correctness | Successful, rejected, aborted, dropped, and unknown outcomes |
| Reliability | Success rate and failure reasons |
| Latency | Quote, submission-to-broadcast, and broadcast-to-confirmation latency |
| Economics | Quoted sBTC fees, STX fees paid, and estimated-versus-actual fee error |
| Safety | Replays rejected, modified transactions rejected, and simulation failures blocked |
| Concurrency | Quote conflicts, nonce conflicts, and nonce incidents |
| Operations | Sponsor balance alerts, upstream error rate, and relay availability |

The report MUST distinguish measured results from projections. Testnet economics
MUST NOT be presented as evidence of mainnet profitability.

## 13. Risks and contingency rules

| Risk | Response within v0.1 |
|---|---|
| Official testnet sBTC integration is unavailable | Continue contract semantics with a mock SIP-010 token, but do not declare final acceptance without testnet sBTC or an explicitly approved substitute |
| Rust library lacks a required transaction operation | Isolate and test a compatibility layer or select another maintained library through an ADR |
| Stacks API is inconsistent or unavailable | Configure primary and fallback read endpoints; stop signing when safety-relevant responses disagree |
| Pending transaction pins the sponsor nonce | Stop new sponsorship, reconcile manually, and document the incident; automatic gap repair remains out of scope |
| Fee conversion is unreliable | Use transparent, versioned operator configuration with conservative limits; do not claim market-optimal pricing |
| Pilot volume is below target | Extend the pilot window rather than reducing the 100-transaction or 10-wallet acceptance threshold |
| Security issue requires protocol change | Fix the protocol and regenerate fixtures before continuing; schedule pressure does not waive a release-blocking gate |

## 14. Post-v0.1 sequence

No post-v0.1 feature is part of this roadmap's definition of done. After the
PoC report is accepted, candidate work should be prioritized from measured
limitations in this order:

1. production hardening and independent security review;
2. a second reviewed adapter or sponsored withdrawal flow;
3. multiple sponsor accounts and improved reconciliation;
4. multi-operator discovery and routing, including the registry and randomized
   assignment specifications; and
5. v0.2 batching experiments measured against the v0.1 baseline.

Each addition requires its own scope, threat-model update, acceptance criteria,
and release decision.
