# Readiness validation — October 14, 2026

Grant-ready completion is not claimed. Existing user edits were preserved. Tasks
requiring a person or deployment evidence are marked MANUAL/MIXED in the checklist
and enumerated in [the manual register](MANUAL-TASKS.md).

## Executed checks

- Repository and UI TypeScript checks passed; normal production build passed.
- UI unit tests passed (16 named tests plus public deployment validation and the
  production-format quote/origin-signing safeguard suite).
- Production-format relay quotes verified locally, including all signed field
  mutations, absent/empty/populated memos, freshness, balance and intent binding.
- Relay policy, durable quote-store, nonce-store, transaction-state and x402 tests
  passed. Beta access/pause tests (4) and durable budget/accounting tests (6) passed.
- **114 browser checks passed** in Chromium, Firefox and WebKit at widths 390 and
  1440: disconnected/offline, restored receipt states, actual quote/sign/submit
  fixture flow, verified maximum outflow and block countdown, wallet rejection,
  tampered/expired quote, zero/unavailable balance, paused operator, beta credential
  recovery, rejection of broadcast-only wallet responses, explorer links, refresh
  recovery, broadcast → pending → confirmed transitions without resubmission, horizontal overflow and automated axe on tested fixture states.
- The isolated fixture build refuses real faucet requests (server-side 503), uses
  unreachable relay/chain upstreams outside interception, and shows a yellow
  MOCKED DEMO banner. Fixture screenshots are generated per tested signing/error
  path under ignored `test-results`; they are not public-wallet evidence.
- Baseline and static-compatible CSP/security headers checked in browser tests.
  Inline scripts/styles remain permitted for static Next hydration/wallet UI;
  installed extension compatibility is not established by injected fixtures.
- Local beta HTTP tests reject missing credentials, wrong origins and request
  limits before processing. Credentials stay in memory and scoped to one relay.
- Budget tests exercise concurrency, persistence after restart, daily reset,
  carried unknown exposure, immutable signed IDs, no extra integrated broadcast,
  exact recipient/reimbursement and actual STX fee accounting, aborts, changed or
  truncated chain receipts and corrupt ledgers. Operator accounting reads require
  direct loopback and a separate secret; forwarded and anonymous reads reject.
- The opt-in real UI/chain receipt smoke is implemented; its default execution
  reported **1 skipped**, with no live transaction success claimed.
- Earlier read-only HTTPS `/v1/info` check of `https://relay.ossr.network` reported
  testnet and enabled sponsorships. No deployed relay/UI settings were changed.

## Manual acceptance remaining

- Actual Leather and Xverse origin-only signing and zero-STX public wallet flows,
  followed by the opt-in live smoke against the real saved receipt.
- Full keyboard and assistive-technology pass, real wallet overlays/mobile
  handoff and wallet compatibility under the security headers.
- Actual HTTPS/CORS deployment and synchronized/protected simulation node;
  service restart, exclusive sponsor ownership, backups/restoration and rollback.
- Grant screenshots and 3–5 minute wallet-driven video; independent clean-checkout
  reproduction; tester onboarding and private credential distribution/revocation.
- Choose budget amounts, enable access and budget controls on the deployed relay,
  configure monitoring delivery for local alert signals, and execute every live
  recovery/accounting drill. These controls are opt-in and were not activated.
- Two weeks with 5–10 testers, at least 100 confirmed transfers, and all submitted,
  aborted and unknown outcomes reconciled without duplicate payments/conflicting
  signatures or unexpected movements.

The JSON control stores support one process and do not establish multi-host,
multi-process or power-loss durability. Budgets use commitment-day accounting;
unknown exposure never expires automatically. The unreimbursed cap is a sponsor
STX exposure measure, not market-price-based profit accounting. See
[beta controls](BETA-ACCESS.md) for precise semantics and setup.
