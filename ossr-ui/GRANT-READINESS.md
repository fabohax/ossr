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
wallet evidence is claimed. See [P0 validation and setup](P0-VALIDATION.md).

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

- [ ] Prove origin-only sponsored signing with the supported browser wallets.
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

- [ ] Run and record one wallet-driven public testnet success from a zero-STX
      user through the UI, including before/after balances, wallet prompt,
      transaction ID, confirmation, recipient amount, sponsor reimbursement,
      and sponsor STX fee.
  - Acceptance: evidence is linked from the pre-grant roadmap and can be repeated
    from the documented setup without editing source files.

## P1 — Required for a credible review

- [ ] Add unit tests for `lib/ossr.ts`: URL normalization, quote verification,
      transaction arguments, exact post-condition construction, memo encoding,
      wallet response parsing, status classification, and API error mapping.

- [ ] Add component tests for disconnected, relay-offline, quote-ready,
      wallet-rejected, broadcast, pending, success, abort, dropped, and retryable
      dependency states.

- [ ] Add an end-to-end browser suite with mocked wallet and relay providers,
      plus one opt-in live-testnet smoke test. Assert that rejected paths never
      call broadcast and that the successful path renders its explorer link.

- [ ] Complete an accessibility pass: keyboard-only flow, visible focus,
      associated labels and descriptions, live regions for errors/status,
      non-color status cues, reduced-motion handling, contrast, and automated
      axe checks.

- [ ] Complete responsive-browser testing on mobile and desktop widths in
      Chromium, Firefox, and WebKit. Verify long addresses, quote IDs,
      transaction IDs, wallet overlays, and error text do not break layout.

- [ ] Replace the raw transaction JSON as the primary outcome with a concise
      receipt showing amount, fee, recipient, sponsor, status, block height, and
      explorer link. Keep raw data behind an optional technical-details control.

- [ ] Show clear testnet and prototype-only warnings near the wallet action,
      including the exact maximum sBTC outflow and the fact that the sponsor—not
      the user—pays STX.

- [ ] Remove the 500 ms local-storage polling workaround. Use explicit wallet
      lifecycle events where supported and bounded focus/visibility refreshes as
      fallback.

- [ ] Add deterministic loading, disabled, empty, success, and error states for
      relay discovery and sBTC balance lookup. Do not silently hide dependency
      errors behind `Not loaded` or `Loading` indefinitely.

## P1 — Deployment and operational readiness

- [ ] Define and validate deployment configuration for the relay URL, Stacks API
      URL, trusted quote public key, network, adapter, and sBTC contract. Fail the
      build or render an explicit configuration error when required production
      values are missing.

- [ ] Serve the UI and relay through HTTPS-compatible origins and document CORS
      configuration. A deployed HTTPS page must never depend on an HTTP relay or
      local-only hostname.

- [ ] Add security headers appropriate for wallet interaction: Content Security
      Policy, frame restrictions, referrer policy, permissions policy, and MIME
      sniffing protection. Verify that the selected wallets still function.

- [ ] Add privacy-conscious client diagnostics for relay reachability, quote,
      wallet request, submission, and confirmation timing. Never log private
      keys, full signed transaction bytes, or unnecessary wallet identifiers.

- [ ] Add a deployment runbook covering build, environment configuration,
      rollback, relay compatibility, health verification, and the live smoke
      test. Pin supported Node.js and package-manager versions.

## P2 — Presentation and handoff

- [ ] Add concise in-product guidance for connecting a supported testnet wallet,
      obtaining testnet sBTC, choosing a recipient, reviewing the exact outflow,
      and recovering from common failures.

- [ ] Create a deterministic demo mode or fixture layer that exercises the full
      UI without real funds while remaining visually distinct from live testnet.

- [ ] Capture grant-review screenshots and a 3–5 minute wallet-driven video:
      connect, zero-STX balance, quote, exact outflow review, wallet signature,
      relay submission, confirmation, explorer evidence, and one safe rejection.

- [ ] Have a second developer follow the UI setup and live-testnet procedure from
      a clean checkout. Record environment, wallet, elapsed time, problems, and
      fixes without author assistance.

- [ ] Publish a short compatibility and limitations matrix covering supported
      wallets, browsers, mobile behavior, relay availability, testnet-only scope,
      quote verification, persistence, and known failure recovery behavior.

## Definition of grant-ready

The UI is grant-ready when every P0 item and both P1 sections are complete, the
wallet-driven live transaction is publicly verifiable, a second developer can
repeat the flow, and the application makes no production, mainnet, audit, or
wallet-compatibility claim beyond the recorded evidence.
