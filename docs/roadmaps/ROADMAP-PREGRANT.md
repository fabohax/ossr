# OSSR pre-grant prototype roadmap

**Status:** implementation and testnet evidence in progress

**Last updated:** September 18, 2026

**Target:** a grant-reviewable Stacks testnet demonstration, not a production relay

**UI readiness update (October 14, 2026):** See the
[task checklist](../../ossr-ui/GRANT-READINESS.md),
[executed checks and remaining evidence](../../ossr-ui/READINESS-VALIDATION.md),
[deployment and wallet runbook](../../ossr-ui/DEPLOYMENT-RUNBOOK.md), and
[wallet evidence template](../../ossr-ui/EVIDENCE-TEMPLATE.md). Public wallet
acceptance and grant-ready completion are not claimed.

## 1. Outcome

The pre-grant prototype proves one narrow user story:

> A user holding testnet sBTC and zero STX signs one sBTC transfer, an OSSR
> relay validates and sponsors it, the recipient receives the requested sats,
> and the relay receives the quoted sats atomically while paying the network fee
> in STX.

The demonstration is complete only when that flow is reproducible from the
documented setup, has a public explorer transaction, and exercises the primary
failure cases before the sponsor signs.

## 2. Scope freeze

### Included

- Stacks testnet only.
- One independently operated relay and sponsor account.
- One action: `sponsored-transfer` through the allowlisted sBTC adapter.
- Signed, short-lived, single-use quotes denominated in sats.
- Origin-signed sponsored transactions and relay-controlled broadcasting.
- Atomic recipient transfer and sponsor reimbursement in the same transaction.
- A minimal wallet UI and CLI workflow.
- Local Clarinet/devnet testing and a public testnet acceptance run.
- Basic operator health, transaction status, structured logs, and demo metrics.

### Deferred to the funded v0.1 implementation

- Rust relay and protocol core.
- PostgreSQL and multi-instance coordination.
- Production-grade nonce recovery and ambiguous-broadcast reconciliation.
- Docker deployment and production operations.
- Multiple relays, registry governance, randomized routing, and reputation.
- Operator-funded protocol maintenance through a one-time listing fee verified
  before registry activation.
- A 100-transaction, 10-wallet public pilot.
- Additional adapters, withdrawals, batching, mainnet, HSMs, and formal audit.

The detailed funded implementation remains in [ROADMAP-v1.md](ROADMAP-v1.md).
It is not a prerequisite for presenting the pre-grant prototype.

## 3. What already works

- [x] Protocol, architecture, API, adapter, reimbursement, and threat-model docs.
- [x] Low-level origin-sign, sponsor-sign, broadcast, and confirmation PoC.
- [x] Testnet-only operator with balance checks and in-process nonce serialization.
- [x] Relay endpoints for metadata, quotes, sponsorship, health, and status.
- [x] Atomic sBTC adapter that pays the recipient and actual `tx-sponsor?`.
- [x] Keep payout settlement minimal: one sponsor reimbursement and no protocol
      payment or protocol-payment record.
- [x] Separate protocol funding from user transactions: any maintenance
      incentive comes from an operator listing fee, not a per-transfer charge.
- [x] Exact-amount client post-condition construction in the CLI and wallet UI.
- [x] Explicit transaction states and failure classifications.
- [x] Local operator registry, heartbeat health, and capacity-only failover seam.
- [x] Clarinet simnet tests and a local devnet smoke path using mock sBTC.
- [x] Next.js wallet UI for quote, origin signing, submission, and status.
- [x] Root typecheck, contract tests, component tests, UI typecheck, and UI build.

## 4. Remaining work

### P0 — Safe sponsorship gate

No sponsor signature may be produced until static policy checks pass. The
signature is then held in memory for Stacks Core simulation and must never be
broadcast or treated as a consumed nonce unless simulation succeeds.

- [x] Require a relay-issued quote for `/v1/sponsorships`.
- [x] Disable unquoted sponsorship, including the legacy route.
- [x] Reject unknown, expired, or origin-mismatched quotes and return the stored
      result for an exact retry of a completed quote.
- [x] Validate the network, origin signature, adapter, function, and every argument.
- [x] Require post-condition mode `Deny`.
- [x] Require exactly one fungible-token post-condition for the quote origin.
- [x] Require the configured sBTC asset and exact `amount + sponsor fee` outflow.
- [x] Reject all additional post-conditions and asset-transfer permissions.
- [x] Simulate the fully signed transaction in memory before broadcast; the
      Stacks Core RPC requires complete origin and sponsor authorization.
- [x] Reject failed, ambiguous, stale, or malformed simulation responses.
- [x] Atomically reserve quote consumption before signing and preserve a
      deterministic outcome for duplicate submissions.
- [x] Persist quotes, request hashes, broadcast transaction IDs, and completed
      sponsorship responses in a local owner-only JSON store.
- [x] Persist sponsor nonce reservations and reconciliation state in a small
      local durable store suitable for the single-relay demo.

For the prototype, a local single-process store is acceptable. PostgreSQL and
cross-instance locking remain funded v0.1 work.

### P1 — Adversarial and integration tests

- [x] Add relay/API tests for malformed transactions and origin mismatch.
- [x] Add mutation tests for amount, recipient, sponsor fee, quote ID, and expiry.
- [x] Add missing, excessive, wrong-asset, wrong-principal, and extra
      post-condition rejection tests.
- [x] Add expired, replayed, and concurrent duplicate quote tests.
- [x] Add fee-limit, insufficient-STX, and failed-broadcast tests.
- [x] Add a failed-simulation test and verify it neither broadcasts nor advances
      the in-process sponsor nonce.
- [x] Run the complete devnet workflow from a clean checkout.

### P2 — Public testnet acceptance

- [x] Confirm the canonical testnet sBTC and deployed adapter principals.
      Verified September 18, 2026 against the live testnet API:
      `SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token` and
      `ST2SY3PZHMVQMYN1W4SBJ9MPHW4P8J01ST7TVQ68X.sbtc-sponsored-transfer-v1`.
- [x] Record the immutable adapter deployment transaction and contract principal
      in [the testnet deployment record](../TESTNET-DEPLOYMENT.md).
- [x] Fund an isolated, low-balance testnet sponsor account. The environment's
      `OPERATOR_PRIVATE_KEY` resolves to
      `ST2QKEV89ZB3PCW1KC8206FDFJ7F6QANMR22ZG7F5`; its sole transaction funded
      it with `2 STX`. Evidence is in
      [the testnet deployment record](../TESTNET-DEPLOYMENT.md#acceptance-sponsor-account).
- [x] Start with a user that holds sufficient testnet sBTC and zero STX. The
      environment-derived acceptance user
      `ST14MZ2VA0731Q6TEPK82FDQNHWKY8NPEMND33NE4` holds `2,000` sats and
      `0` microSTX; see
      [the testnet deployment record](../TESTNET-DEPLOYMENT.md#zero-stx-acceptance-user).
- [x] Complete at least 10 successful sponsored transfers. Verified September
      19, 2026: the deployed adapter has ten successful sponsored-transfer
      calls, including nine consecutive zero-STX acceptance-user transfers
      recorded in [the testnet deployment record](../TESTNET-DEPLOYMENT.md#sponsored-transfer-acceptance-run).
- [x] Record at least one controlled rejection for each primary pre-signing
      failure class. Verified September 19, 2026 for request decoding,
      quote/intent binding, static transaction policy, and deterministic
      execution simulation; evidence is in
      [the testnet deployment record](../TESTNET-DEPLOYMENT.md#controlled-rejection-run).
- [x] Capture explorer links and before/after balances for user, recipient, and
      sponsor. All nine acceptance transactions remain canonical and successful;
      the balance table and explorer links are in
      [the testnet deployment record](../TESTNET-DEPLOYMENT.md#sponsored-transfer-acceptance-run).
- [x] Prove that the sponsor paid STX and received the exact quoted sats. Live
      transaction records identify the isolated account as sponsor, charge it
      `125,664` microSTX in aggregate, and transfer exactly the quoted `10` sats
      to it in each of nine acceptance transactions; see
      [the testnet deployment record](../TESTNET-DEPLOYMENT.md#sponsor-payment-proof).

### P3 — Grant presentation and handoff

- [x] Expose a compact operator status view or metrics snapshot: health, STX
      balance, requests, rejections, broadcasts, confirmations, and costs.
- [x] Record quote latency, submission-to-broadcast latency,
      broadcast-to-confirmation latency, STX paid, and sats reimbursed.
- [x] Publish one clean setup-and-demo procedure in
      [PREGRANT-DEMO.md](../PREGRANT-DEMO.md).
- [ ] Have a second developer run that procedure without author assistance.
- [x] Publish [known limitations and accepted testnet-only risks](../PREGRANT-LIMITATIONS.md).
- [ ] Record a 3–5 minute demonstration.
- [ ] Tag the pre-grant prototype release.

## 5. Demo script

1. Show that the user has testnet sBTC and zero STX.
2. Connect the wallet and enter the recipient and amount.
3. Request and display a signed quote, including the fee in sats.
4. Sign the sponsor-enabled adapter transaction in the wallet.
5. Show the relay validation and simulation result.
6. Show the relay adding the sponsor authorization and paying the STX fee.
7. Wait for confirmation and open the transaction in the explorer.
8. Show the exact recipient amount and atomic sponsor reimbursement.
9. Show one rejected mutation or replay without a sponsor signature.

## 6. Acceptance evidence

The prototype is grant-ready when all of the following are public:

- [ ] Source and license.
- [ ] Passing type, contract, relay, client, and adversarial test output.
- [ ] Testnet adapter principal and deployment transaction.
- [ ] Explorer link for the zero-STX acceptance transaction.
- [ ] Balance evidence for the user, recipient, and sponsor.
- [ ] Evidence that the sponsor paid the network fee in STX.
- [ ] Evidence that the sponsor received the exact quote in sats atomically.
- [ ] Metrics from the repeated testnet run.
- [ ] Reproducible demo instructions, known limitations, and demonstration video.

## 7. Release blockers

Do not present the prototype as complete if any of these remain true:

- The relay can sign an unquoted or expired transaction.
- The transaction can permit more sBTC outflow than the displayed amount plus fee.
- A failed simulation can reach broadcast or consume the in-process sponsor nonce.
- One quote can produce multiple sponsor signatures.
- Reimbursement can be redirected away from the actual transaction sponsor.
- Mainnet or a non-allowlisted contract call can reach signing.
- The public zero-STX flow cannot be reproduced from the documentation.
- Secrets or private transaction material appear in logs or committed files.

## 8. Immediate execution order

1. Enforce quote expiry and the exact sBTC post-condition before signing.
2. Add pre-sign simulation with fail-closed response handling.
3. Add adversarial relay tests.
4. Run and document the public testnet acceptance flow.
5. Produce metrics, demo video, and the pre-grant release tag.
