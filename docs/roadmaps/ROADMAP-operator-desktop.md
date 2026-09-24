# OSSR Operator Desktop Roadmap

## Status

- **Product:** OSSR Operator Desktop
- **Release target:** v0.1 testnet preview
- **Status:** Planned
- **Target platform:** Linux
- **Estimated delivery:** 10 implementation weeks plus testnet soak
- **Specification:** [operator-desktop.md](../specs/operator-desktop.md)
- **Last updated:** September 21, 2026

## 1. Objective

Deliver a testnet-only Linux desktop application that lets an operator create
isolated keys, configure policy, expose an OSSR relay endpoint, issue signed
quotes, validate and sponsor user transactions, broadcast them, and recover
safely from restarts or ambiguous network outcomes.

The desktop implementation succeeds by conforming to the existing OSSR
protocol. It does not replace the TypeScript reference relay until compatibility
and acceptance gates pass.

## 2. Delivery principles

1. Build a reusable Rust core before coupling protocol logic to Tauri.
2. Establish cross-language fixtures before implementing signing.
3. Keep private keys entirely outside the webview.
4. Make persistent state authoritative before adding public networking.
5. Treat endpoint convenience as subordinate to signing safety.
6. Keep mainnet disabled throughout the roadmap.
7. Require an exit gate before downstream milestones are considered complete.

## 3. Dependency order

```text
protocol fixtures
      |
      v
Rust compatibility spike
      |
      +----> SQLite safety state
      |
      +----> key vault and signer
      |              |
      +--------------+
             |
             v
      embedded relay API
             |
             v
       Tauri operator UI
             |
             v
   HTTPS exposure + registration
             |
             v
 testnet acceptance and packaging
```

## 4. Milestone 0 — Decisions and compatibility spike

**Schedule:** Week 1

### Tasks

- [ ] Record an ADR selecting Tauri 2 and the Rust workspace layout.
- [ ] Inventory every rule and state transition in the TypeScript operator.
- [ ] Freeze versioned quote, transaction, post-condition, and error fixtures.
- [ ] Evaluate Rust Stacks transaction libraries against those fixtures.
- [ ] Prove decoding and canonical re-encoding of origin-signed sponsored calls.
- [ ] Prove origin signature verification and sponsor authorization signing.
- [ ] Prove quote signatures match the existing secp256k1 format.
- [ ] Identify any required compatibility shim and isolate it behind a crate API.
- [ ] Select SQLite, HTTP, async runtime, cryptography, keyring, and secret-memory
      dependencies with version and maintenance rationale.
- [ ] Add Rust formatting, linting, tests, dependency audit, and license checks to
      CI.

### Exit gate

- [ ] Rust verifies every normative TypeScript fixture.
- [ ] TypeScript verifies every Rust-produced quote fixture.
- [ ] A Rust-sponsored test transaction is accepted by Clarinet/devnet.
- [ ] No library gap prevents inspecting every required transaction field.
- [ ] The selected dependencies have documented security ownership.

## 5. Milestone 1 — Rust core and durable state

**Schedule:** Weeks 2–3

### Protocol core

- [ ] Create a workspace with `protocol`, `relay-core`, `storage`, and `test-fixtures`
      crates.
- [ ] Implement strict configuration types and testnet-only startup enforcement.
- [ ] Implement quote canonicalization, hashing, signing, and verification.
- [ ] Implement transaction decoding and fail-closed validation.
- [ ] Implement the default fee policy using checked integer arithmetic.
- [ ] Implement stable API errors matching the relay specification.
- [ ] Add property and mutation tests for every signed quote field.

### SQLite storage

- [ ] Add versioned migrations for settings, keys, quotes, sponsorships, nonce
      reservations, observations, and audit events.
- [ ] Implement atomic quote issuance and consumption.
- [ ] Implement unique sponsor nonce reservation.
- [ ] Implement idempotent sponsorship result storage.
- [ ] Implement explicit ambiguous-broadcast state and reconciliation evidence.
- [ ] Configure integrity checking, busy timeouts, and safe journaling behavior.
- [ ] Add automatic recoverable backups before migrations.
- [ ] Add crash and concurrency tests around quote and nonce reservation.

### Exit gate

- [ ] Duplicate quote submissions return one deterministic stored outcome.
- [ ] Concurrent requests cannot reserve the same sponsor nonce.
- [ ] Process termination at each lifecycle boundary preserves a safe state.
- [ ] Database corruption produces a paused, actionable failure rather than a
      fresh empty state.

## 6. Milestone 2 — Key vault and signing boundary

**Schedule:** Week 4

### Tasks

- [ ] Implement CSPRNG-backed sponsor and quote-key generation.
- [ ] Derive and display compressed public keys and testnet principals.
- [ ] Integrate Linux Secret Service as the preferred key backend.
- [ ] Implement an authenticated encrypted-vault fallback with a memory-hard KDF.
- [ ] Keep secret material out of serializable Tauri command responses.
- [ ] Add secret redaction to structured logging and error paths.
- [ ] Reject sponsor/quote key reuse.
- [ ] Implement encrypted backup creation and restore verification.
- [ ] Implement quote-key rotation and retired-key retention.
- [ ] Implement sponsor-key rotation as a paused reconciliation workflow.
- [ ] Add zeroization where supported and document unavoidable memory exposure.
- [ ] Threat-model clipboard, swap, core dumps, crash reports, and backups.

### Exit gate

- [ ] Automated tests prove no command returns private material to the webview.
- [ ] Logs and exported diagnostics contain no test secret canaries.
- [ ] Backup and restore recover the same public identities on a clean machine.
- [ ] Restoring mismatched database and key state leaves signing disabled.

## 7. Milestone 3 — Embedded relay and transaction pipeline

**Schedule:** Weeks 5–6

### Relay API

- [ ] Implement `/v1/info`, `/v1/quotes`, `/v1/sponsorships`, status, liveness,
      and readiness endpoints.
- [ ] Add request-size, content-type, timeout, CORS, and rate-limit enforcement.
- [ ] Add sanitized request IDs and security audit events.
- [ ] Bind to loopback by default and warn on wider interfaces.
- [ ] Publish active and retired quote-key metadata correctly.

### Sponsorship pipeline

- [ ] Validate network, origin, adapter, function, arguments, expiry, and quote.
- [ ] Validate exact deny-mode sBTC post-conditions and maximum outflow.
- [ ] Integrate fee estimation and sponsor balance checks.
- [ ] Integrate Stacks Core simulation with strict response validation.
- [ ] Reserve quote and nonce durably before sponsor signing.
- [ ] Broadcast only the successfully simulated transaction bytes.
- [ ] Persist transport errors as ambiguous when acceptance cannot be excluded.
- [ ] Reconcile broadcast and chain status across restarts.
- [ ] Add upstream failover without weakening consistency checks.

### Exit gate

- [ ] All existing relay API policy tests pass against the Rust service.
- [ ] Every controlled mutation is rejected before sponsor signing.
- [ ] Failed simulation never broadcasts or releases unsafe state.
- [ ] Exact retries are idempotent across process restarts.
- [ ] The complete local devnet flow succeeds through the Rust relay.

## 8. Milestone 4 — Tauri application foundation

**Schedule:** Week 7

### Tasks

- [ ] Create `apps/operator-desktop` with a Tauri 2 shell and reusable UI package.
- [ ] Define narrow Tauri commands for status, setup, policy, and operator actions.
- [ ] Configure CSP, navigation restrictions, and capability allowlists.
- [ ] Add system tray lifecycle and explicit stop/quit behavior.
- [ ] Add opt-in Linux autostart and locked-start behavior.
- [ ] Implement relay state events without leaking request or secret material.
- [ ] Implement an emergency pause available from both window and tray.
- [ ] Add accessibility, keyboard navigation, and destructive-action confirmations.

### Exit gate

- [ ] The webview cannot invoke arbitrary shell or filesystem operations.
- [ ] Closing the window cannot silently stop an active relay.
- [ ] Emergency pause prevents a newly queued signing operation.
- [ ] Autostart never bypasses the configured vault unlock policy.

## 9. Milestone 5 — Setup and operator experience

**Schedule:** Week 8

### Setup wizard

- [ ] Implement testnet warning and storage-backend selection.
- [ ] Generate or explicitly import isolated keys.
- [ ] Show sponsor funding address and live balance.
- [ ] Configure and test Stacks API and simulation RPC.
- [ ] Pin adapter and sBTC contract principals.
- [ ] Configure pricing, limits, CORS, and pause defaults.
- [ ] Run a complete readiness self-test before enabling service.

### Operational UI

- [ ] Build dashboard health, balances, endpoint, tip, latency, and metrics cards.
- [ ] Build key identity, backup, and rotation screens.
- [ ] Build quote and transaction lifecycle tables and detail timelines.
- [ ] Build policy editor with unapplied-change and validation states.
- [ ] Build sanitized log viewer and diagnostic export preview.
- [ ] Build database integrity, backup, restore, and reconciliation tools.
- [ ] Link transaction IDs to the correct Stacks explorer network.

### Exit gate

- [ ] A new evaluator can reach local-ready state without command-line setup.
- [ ] No workflow asks the operator to copy the quote public key as raw hex.
- [ ] Every degraded readiness condition has an actionable explanation.
- [ ] Dangerous recovery and key operations require fresh confirmation.

## 10. Milestone 6 — Public endpoint and registration

**Schedule:** Week 9

### Tasks

- [ ] Specify the tunnel control protocol and threat model before implementation.
- [ ] Select a tunnel provider or document the user-managed HTTPS baseline.
- [ ] Pin and checksum any bundled sidecar artifact.
- [ ] Restrict sidecar commands and arguments through Tauri capabilities.
- [ ] Implement tunnel start, stop, reconnect, and readiness state.
- [ ] Verify the endpoint externally rather than only through loopback.
- [ ] Reserve and validate the `*.relay.ossr.network` naming policy if managed
      subdomains are offered.
- [ ] Generate a one-time registration handoff containing only public metadata.
- [ ] Update the web registration form to fetch `/v1/info` and prefill the quote
      public key.
- [ ] Keep owner-wallet signing in the browser and outside the desktop vault.
- [ ] Verify CORS and TLS behavior from the production OSSR UI.

### Exit gate

- [ ] A remote browser can fetch public relay metadata and request a quote over
      HTTPS.
- [ ] Tunnel credentials cannot request local signing outside the relay policy.
- [ ] Registration publishes the same active quote key as `/v1/info`.
- [ ] Loss of the public tunnel changes readiness without corrupting local state.

## 11. Milestone 7 — Hardening, packaging, and testnet preview

**Schedule:** Week 10 plus a minimum two-week soak

### Hardening

- [ ] Fuzz HTTP decoders, quote parsers, and transaction decoding.
- [ ] Run fault injection at every persistent state transition.
- [ ] Test malformed, stale, contradictory, and unavailable upstream responses.
- [ ] Test pause, shutdown, power loss, database lock, disk-full, and clock-change
      behavior.
- [ ] Run dependency audit, license review, static analysis, and secret scanning.
- [ ] Conduct a focused manual review of signing and key-storage code.

### Packaging

- [ ] Produce AppImage and Debian artifacts in CI.
- [ ] Publish signed checksums and a software bill of materials.
- [ ] Test installation, upgrade, rollback, and removal on supported Linux images.
- [ ] Implement signed application updates with opt-in preview channel.
- [ ] Publish minimum distribution, webview, keyring, and architecture requirements.

### Acceptance and documentation

- [ ] Complete at least ten public testnet sponsorships through the desktop relay.
- [ ] Exercise duplicate, expired, mutated, failed-simulation, and ambiguous cases.
- [ ] Restore an encrypted backup onto a second Linux machine and reconcile.
- [ ] Run continuously through the soak period without nonce or idempotency loss.
- [ ] Publish installation, setup, operations, backup, recovery, and incident guides.
- [ ] Publish known limitations and a testnet-only warning.
- [ ] Record a setup-to-confirmation demonstration.
- [ ] Tag and sign the v0.1 preview release.

### Exit gate

- [ ] Every acceptance criterion in the desktop specification is satisfied.
- [ ] There are no open Critical or High security findings.
- [ ] The TypeScript and Rust conformance suites remain green.
- [ ] A second operator completes setup without author assistance.
- [ ] Mainnet remains unavailable in release artifacts.

## 12. Post-preview backlog

These tasks are explicitly outside the v0.1 preview:

- [ ] Split the Rust core into an optional system service and unprivileged UI.
- [ ] Support hardware or remote sponsor signers.
- [ ] Add multiple upstream simulation providers with quorum policy.
- [ ] Add multiple sponsor accounts with explicit allocation policy.
- [ ] Add remote, read-only monitoring with operator-controlled authentication.
- [ ] Package and validate Flatpak distribution.
- [ ] Add macOS and Windows ports after Linux security behavior is stable.
- [ ] Commission an external audit and publish dispositions.
- [ ] Define a separate mainnet release plan, limits, and incident process.

## 13. Release blockers

The preview MUST NOT ship if any of the following is true:

- private key material can reach the webview, logs, clipboard, or diagnostics;
- the service can sponsor a transaction without a valid relay-issued quote;
- quote consumption or sponsor nonce allocation is not crash-safe;
- failed simulation can reach broadcast;
- ambiguous broadcast state can be cleared automatically;
- the public endpoint exposes unrestricted local application commands;
- update artifacts are unsigned or update verification can overwrite the working
  installation on failure;
- setup permits mainnet or an unpinned adapter silently; or
- backup and recovery have not been demonstrated on a separate machine.
