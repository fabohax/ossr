# OSSR UI grant-readiness checklist

**Baseline:** September 19, 2026
**Scope:** testnet-only wallet interface for the OSSR v0.1 sponsored sBTC transfer

The current application type-checks and produces a successful Next.js
production build. It can discover a wallet address, request a quote, construct
the exact sponsored adapter call and post-condition, submit origin-signed bytes,
poll relay status, and link successful transactions to the Hiro explorer.

Implementation update (October 3, 2026): browser policy and recovery changes are
implemented and covered by local tests and a production build. Wallet extension
compatibility and the public wallet-driven acceptance run remain open; no live
wallet evidence is claimed. See [P0 validation and setup](READINESS-VALIDATION.md).

Implementation update (October 14, 2026): unit and receipt-recovery browser tests,
public configuration validation, baseline headers, diagnostics, receipt fields,
product guidance, and operational/evidence documentation added. See
[current validation and remaining work](READINESS-VALIDATION.md). Live wallet,
independent reviewer and sustained beta evidence remain pending.

Implementation follow-up: the actual UI now has an isolated, labeled wallet/relay
fixture layer, component-state and full signing-flow browser coverage (114 passing
checks), an opt-in live receipt verifier, explicit dependency failures, and a block
countdown. Opt-in beta access, durable limits/accounting, pause and local alerts
are implemented and tested. Activation and all real-wallet/beta evidence remain
manual; no grant-ready or deployed-controls claim is made.

Task tags: **[MANUAL]** requires a person, real wallet interaction, deployment
access, or elapsed live use. **[MIXED]** has implementation/automation work plus
manual acceptance evidence. Untagged tasks can be completed locally. A tag does
not mark a task complete. Manual procedures are in [the runbook](DEPLOYMENT-RUNBOOK.md)
and must be recorded using [the evidence template](EVIDENCE-TEMPLATE.md).
See [the manual task register](MANUAL-TASKS.md) for owners/actions/evidence.

## P0 — Required for a grant demonstration

- [x] Verify relay quote signatures in the browser before constructing a wallet
      request. Pin or explicitly trust the expected quote public key, reproduce
      the protocol signing digest, reject invalid signatures, and reject an
      unexpected key ID, relay ID, network, policy version, adapter, sBTC asset,
      sponsor, action, or function.
  - Acceptance: a valid production-format quote passes; mutations to every
    signed field fail locally before the wallet opens.

- [x] Validate quote freshness against a current Stacks testnet height and show
      a visible block countdown.
  - Acceptance: an expired quote cannot be signed, and the UI asks for a fresh
    quote without losing the transfer form.

- [x] Freeze the reviewed transfer intent after quote issuance. Any change to
      origin, recipient, amount, maximum fee, memo, relay URL, or network must
      invalidate the quote and require a new one.
  - Acceptance: the values displayed in Review are the exact values encoded in
    the wallet request; stale form state cannot be submitted.

- [x] Add strict client-side validation for canonical testnet principals,
      positive integer sats, memo length/encoding, recipient-not-origin, relay
      URL, and `amount + sponsor fee <= available sBTC`.
  - Acceptance: invalid input produces field-level guidance and never opens a
    wallet prompt or calls the sponsorship endpoint.

- [x] Make wallet identity authoritative. Treat the address returned by Stacks
      Connect as read-only, clearly show testnet, detect account/network changes,
      and invalidate dependent balance and quote state on change or disconnect.
  - Acceptance: the origin shown in the UI always matches the account that signs
    the transaction.

- [ ] **[MANUAL]** Prove origin-only sponsored signing with the supported browser wallets.
      Test at least Leather and Xverse, record versions and results, and verify
      that each returns raw origin-signed bytes without broadcasting directly.
  - Acceptance: at least one documented wallet completes the public testnet flow;
    unsupported wallets receive a precise compatibility message before funds are
    at risk.

- [x] Replace generic transport errors with stable, user-facing relay errors.
      Cover quote expiry/mismatch, invalid post-conditions, stale or unavailable
      simulation, insufficient sBTC, insufficient sponsor STX, replay, and
      confirmation timeout.
  - Acceptance: messages explain whether retrying is safe and whether a
    transaction may already have been broadcast.

- [x] Make the post-submit flow durable. Persist the transaction ID and reviewed
      quote summary, resume status polling after refresh, distinguish broadcast,
      pending, confirmed, aborted, dropped, and unknown states, and always expose
      the explorer link once a transaction ID exists.
  - Acceptance: refreshing or temporarily losing the relay cannot make an
    already-submitted transaction disappear from the UI.

- [ ] **[MANUAL]** Run and record one wallet-driven public testnet success from a zero-STX
      user through the UI, including before/after balances, wallet prompt,
      transaction ID, confirmation, recipient amount, sponsor reimbursement,
      and sponsor STX fee.
  - Acceptance: evidence is linked from the pre-grant roadmap and can be repeated
    from the documented setup without editing source files.

## P1 — Required for a credible review

- [x] Add unit tests for `lib/ossr.ts`: URL normalization, quote verification,
      transaction arguments, exact post-condition construction, memo encoding,
      wallet response parsing, status classification, and API error mapping.

- [x] Add component tests for disconnected, relay-offline, quote-ready,
      wallet-rejected, broadcast, pending, success, abort, dropped, and retryable
      dependency states.

- [ ] **[MIXED]** Add an end-to-end browser suite with mocked wallet and relay providers,
      plus one opt-in live-testnet smoke test. Assert that rejected paths never
      call broadcast and that the successful path renders its explorer link.
  - [x] Actual UI fixture flow with production-format quotes, mock origin signing,
    exact outflow verification, no-broadcast checks, receipt and error states.
  - [x] Opt-in real receipt/chain/UI smoke verifier (`npm run test:live`).
  - [ ] **[MANUAL]** Run the live smoke with an actual wallet-derived receipt (M02).

- [ ] **[MIXED]** Complete an accessibility pass: keyboard-only flow, visible focus,
      associated labels and descriptions, live regions for errors/status,
      non-color status cues, reduced-motion handling, contrast, and automated
      axe checks.
  - [x] Automated axe checks on disconnected, connected, successful and rejected
    fixture paths; reduced motion and visible focus implemented.
  - [ ] **[MANUAL]** Full keyboard/assistive-technology/extension review (M04).

- [ ] **[MIXED]** Complete responsive-browser testing on mobile and desktop widths in
      Chromium, Firefox, and WebKit. Verify long addresses, quote IDs,
      transaction IDs, wallet overlays, and error text do not break layout.
  - [x] Automated mobile/desktop layout, error and receipt checks in all three engines.
  - [ ] **[MANUAL]** Installed wallet overlays and mobile handoff (M04).

- [x] Replace the raw transaction JSON as the primary outcome with a concise
      receipt showing amount, fee, recipient, sponsor, status, block height, and
      explorer link. Keep raw data behind an optional technical-details control.

- [x] Show clear testnet and prototype-only warnings near the wallet action,
      including the exact maximum sBTC outflow and the fact that the sponsor—not
      the user—pays STX.

- [x] Remove the 500 ms local-storage polling workaround. Use explicit wallet
      lifecycle events where supported and bounded focus/visibility refreshes as
      fallback.

- [x] Add deterministic loading, disabled, empty, success, and error states for
      relay discovery and sBTC balance lookup. Do not silently hide dependency
      errors behind `Not loaded` or `Loading` indefinitely.

## P1 — Deployment and operational readiness

- [x] Define and validate deployment configuration for the relay URL, Stacks API
      URL, trusted quote public key, network, adapter, and sBTC contract. Fail the
      build or render an explicit configuration error when required production
      values are missing.

- [ ] **[MIXED]** Serve the UI and relay through HTTPS-compatible origins and document CORS
      configuration. A deployed HTTPS page must never depend on an HTTP relay or
      local-only hostname.
  - [x] Public HTTPS configuration validation, same-origin proxy and CORS runbook.
  - [ ] **[MANUAL]** Verify actual deployed UI/relay origins and OPTIONS behavior (M03).

- [ ] **[MIXED]** Add security headers appropriate for wallet interaction: Content Security
      Policy, frame restrictions, referrer policy, permissions policy, and MIME
      sniffing protection. Verify that the selected wallets still function.
  - [x] Static-compatible CSP and security headers implemented; fixture browser checks pass.
  - [ ] **[MANUAL]** Installed Leather/Xverse compatibility under the deployed headers (M05).

- [x] Add privacy-conscious client diagnostics for relay reachability, quote,
      wallet request, submission, and confirmation timing. Never log private
      keys, full signed transaction bytes, or unnecessary wallet identifiers.

- [x] Add a deployment runbook covering build, environment configuration,
      rollback, relay compatibility, health verification, and the live smoke
      test. Pin supported Node.js and package-manager versions.

## P2 — Presentation and handoff

- [x] Add concise in-product guidance for connecting a supported testnet wallet,
      obtaining testnet sBTC, choosing a recipient, reviewing the exact outflow,
      and recovering from common failures.

- [x] Create a deterministic demo mode or fixture layer that exercises the full
      UI without real funds while remaining visually distinct from live testnet.

- [ ] **[MANUAL]** Capture grant-review screenshots and a 3–5 minute wallet-driven video:
      connect, zero-STX balance, quote, exact outflow review, wallet signature,
      relay submission, confirmation, explorer evidence, and one safe rejection.

- [ ] **[MANUAL]** Have a second developer follow the UI setup and live-testnet procedure from
      a clean checkout. Record environment, wallet, elapsed time, problems, and
      fixes without author assistance.

- [x] Publish a short compatibility and limitations matrix covering supported
      wallets, browsers, mobile behavior, relay availability, testnet-only scope,
      quote verification, persistence, and known failure recovery behavior.

## Definition of grant-ready

The UI is grant-ready when every P0 item and both P1 sections are complete, the
wallet-driven live transaction is publicly verifiable, a second developer can
repeat the flow, and the application makes no production, mainnet, audit, or
wallet-compatibility claim beyond the recorded evidence.

## Closed testnet beta — Preparation for a limited mainnet beta

**Added:** October 14, 2026
**Status:** Proposed requirements and exit criteria; completion is not claimed.

This milestone extends the grant demonstration into sustained use by invited
testers. It covers the UI, relay, and operator infrastructure. Its purpose is to
prove the wallet flow, policy enforcement, accounting, and failure recovery
before preparing a limited mainnet beta.

### Required before and during the beta

- [ ] **[MIXED]** Enforce a wallet allowlist in the relay and match the authorized wallet to
      the cryptographically verified transaction origin. Authenticate access to
      quote and simulation requests and apply request limits. Restricting the UI
      alone does not restrict the relay.
  - [x] Implemented opt-in relay credential/allowlist/origin-binding/rate-limit
    controls, UI in-memory credential input, and local HTTP rejection tests.
    See [beta access setup](BETA-ACCESS.md).
  - [ ] **[MANUAL]** Activate and validate on the deployed relay; distribute and
    revoke invited-wallet credentials (M10).

- [ ] **[MANUAL]** Deploy the UI and relay over HTTPS with a synchronized testnet simulation
      node, automatic service restart, persistent storage, and tested backups.
      One relay process with exclusive ownership of one sponsor account is
      sufficient for this stage.

- [ ] **[MANUAL]** Record complete live flows with both Leather and Xverse: a user holding
      testnet sBTC and zero STX reviews a verified quote, signs without wallet
      broadcast, submits through the relay, and receives a confirmed receipt.
      Record wallet/browser versions, transaction IDs, before/after balances,
      exact recipient payment, sponsor reimbursement, and sponsor STX cost.
      Existing CLI acceptance evidence does not replace these wallet runs.

- [ ] **[MIXED]** Exercise recovery after signing and after broadcast, including process
      restart, RPC timeout, a stale simulation node, expired quotes, concurrent
      requests, and duplicate clicks. Verify that no duplicate payment or
      conflicting sponsor-nonce use occurs. Document reconciliation of ambiguous
      submissions and demonstrate that retries cannot create a second distinct
      sponsorship for the same quote.
  - [x] Local quote/nonce persistence, concurrent budget, immutable signed-ID,
    completed-quote reuse, receipt-refresh and no-extra-broadcast regression tests.
  - [ ] **[MANUAL]** Execute the deployed signing/broadcast/RPC/simulation recovery
    drills and record reconciliation with actual chain outcomes (M09).

- [ ] **[MIXED]** Enforce transfer, per-wallet, and daily limits, plus a sponsor STX spending
      budget and loss cap. Provide an operator control to pause new sponsorships
      and alerts for low sponsor balance, unavailable simulation, and stuck
      transactions. Persist transaction outcomes, STX costs, and sBTC
      reimbursements and reconcile them against chain state.
  - [x] Persistent local operator pause flag, restart behavior, and UI disabled state.
  - [x] Configurable durable transfer/wallet/day/STX/exposure limits, exact chain
    recipient/reimbursement accounting, and loopback alert/reconciliation endpoint.
    See [beta controls](BETA-ACCESS.md); local tests include integrated no-extra-broadcast checks.
  - [ ] **[MANUAL]** Choose policy amounts, activate both control sets, connect
    local alerts to monitoring, and execute actual chain/accounting drills (M09/M11).

- [ ] **[MANUAL]** Have an independent developer configure the relay and complete the flow
      using the runbook. Give testers onboarding instructions, access to test
      funds, and a reporting channel that requests transaction IDs and useful
      diagnostics without requesting secrets or signed transaction bytes.

### Proposed exit criteria

| Evidence | Target |
|---|---|
| Sustained use **[MANUAL]** | 5–10 invited testers over at least two weeks. |
| Confirmed transfers **[MANUAL]** | At least 100 successful sponsored transfers across multiple user wallets. |
| Policy and payment safety **[MIXED]** | Zero out-of-policy sponsorships, conflicting signatures for a quote or sponsor nonce, duplicate payments, or unexpected asset movements. |
| Failure recovery **[MIXED]** | Every recovery scenario above executed with documented outcomes and reconciliation steps. |
| Accounting **[MIXED]** | Every submitted transaction reconciled with its chain outcome, actual STX cost, and actual sBTC reimbursement, including aborted transactions. |
| Wallet compatibility **[MANUAL]** | Complete live-flow evidence for both Leather and Xverse. |

Batching, multiple independent operators, and high availability are outside this
beta's required scope. The current local JSON stores may be retained for one
relay process if backup and recovery are demonstrated; this does not establish
multi-process or multi-host safety.

Meeting these criteria provides evidence for preparing a limited mainnet beta.
Mainnet still requires reviewed network-specific configuration and deployment,
independent security review of the mainnet adapter, protected signing keys, and
controls appropriate for real funds. An invitation-only release does not remove
those requirements. See [prototype limitations](../docs/PREGRANT-LIMITATIONS.md)
and [current UI validation](READINESS-VALIDATION.md).
