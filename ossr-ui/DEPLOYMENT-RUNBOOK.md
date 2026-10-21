# Testnet UI deployment and evidence runbook

Use Node 24 and npm 11.17.0. Install the repository and UI dependencies
with `npm ci` in each directory. Never put sponsor or quote signing private keys
in the UI environment. Public quote verification keys are safe to expose.

## Public deployment configuration

Set `OSSR_DEPLOYMENT=public` for public builds. The build rejects missing trust,
mainnet, noncanonical principals, invalid public keys, HTTP upstreams, credentials
in upstream URLs, and local-only upstreams. Local development may omit this flag;
this does not validate a public deployment. Configure all of:

- `OSSR_RELAY_PROXY_URL`: public HTTPS relay origin.
- `STACKS_API_URL`: public HTTPS Stacks testnet API origin.
- `NEXT_PUBLIC_OSSR_NETWORK=testnet`.
- `NEXT_PUBLIC_OSSR_QUOTE_PUBLIC_KEY`: compressed secp256k1 quote public key.
- `NEXT_PUBLIC_OSSR_RELAY_ID`, `NEXT_PUBLIC_OSSR_QUOTE_KEY_ID`, and
  `NEXT_PUBLIC_OSSR_POLICY_VERSION`: exact values from the selected relay.
- `NEXT_PUBLIC_OSSR_ADAPTER_CONTRACT`, `NEXT_PUBLIC_OSSR_SBTC_CONTRACT`, and
  `NEXT_PUBLIC_OSSR_SPONSOR_PRINCIPAL`: independently verified testnet principals.

Check `/v1/info` against these values and obtain the public key from the operator
through a trusted channel; do not automatically trust keys returned by quotes.
Public environment values are embedded at build time: rebuild after rotation.
Run `npm run test:unit`, `npm run typecheck`, and `npm run build` in `ossr-ui`.
Run repository relay-policy, quote-store, nonce-store, and transaction-state tests.
Record git revision and build logs. Keep the previous artifact and matching
configuration for rollback. Deploy UI behind HTTPS with `OSSR_DEPLOYMENT=public`.

The default browser relay path `/relay` and chain path `/stacks-api` are
same-origin proxies. No CORS headers are required on the upstream for these
server-to-server requests. For direct browser access configure the relay's
`OSSR_CORS_ALLOWED_ORIGINS` to the exact HTTPS UI origin (see `.env.example`); verify
OPTIONS accepts POST and Content-Type, and unapproved origins are rejected.
Never configure wildcard credentialed access. Authentication for invited beta
access is a separate requirement and is not provided by CORS.

Security response headers prohibit framing, object embedding, base URL changes,
cross-origin form actions, referrer transmission, MIME sniffing, and camera,
microphone, and geolocation access. The CSP now restricts scripts to the UI origin and inline Next hydration scripts,
styles to the UI origin and inline wallet styles, connections to the UI origin
and HTTPS/WSS, and limits image/font/worker/frame sources. Development adds eval
and HTTP/WebSocket allowances for Next dev. A static-compatible policy permits
inline scripts; nonce-based XSS hardening would require dynamic-rendering changes.
Installed wallet compatibility remains a manual acceptance check. Do not describe
fixture tests as a complete wallet/CSP review.

## Health and rollback

Verify HTTPS certificates, `/dashboard`, `/relay/v1/info`, and
`/stacks-api/v2/info`. Verify response headers using `curl -I`. Reject unexpected
network or relay identity. Confirm the simulation node is synchronized and
required; confirm sponsor STX funding and durable quote/nonce/outcome stores.
Use one process owning one sponsor. Configure a service restart policy. Back up
stores while the service is stopped and rehearse restoration before beta.
A UI-only health check does not demonstrate safe sponsorship.

Before rollback pause new sponsorships; reconcile all submitted transaction IDs
against chain outcomes. Restore the previous UI artifact with its environment.
Do not restore stale nonce or quote stores over a running relay or reuse a sponsor
nonce based solely on an RPC timeout. Resume only after reconciliation and health
checks. Preserve unknown outcomes for investigation.

## Wallet-driven smoke test (manual opt-in)

Use test funds and a wallet controlled by the tester. Never record seed phrases,
private keys, access tokens, or origin-signed raw transaction bytes. Save evidence
using `EVIDENCE-TEMPLATE.md`. Record actual wallet/browser versions.

1. Start with a testnet user holding sufficient sBTC and exactly zero STX; record
   user, recipient, and sponsor balances and current chain height.
2. Connect Leather or Xverse in testnet mode. Verify the displayed account.
3. Choose a different recipient, transfer amount, fee cap, and optional memo.
4. Verify quote expiry, trusted relay identity, and exact amount plus sBTC fee in
   the wallet prompt. Confirm sponsored, origin-only signing without broadcast.
5. Submit through the relay. Record txid and explorer URL. Refresh while pending;
   confirm the receipt persists. Temporarily disconnect the relay and recover.
6. Wait for chain success. Record block height, recipient payment, sponsor sBTC
   reimbursement, sponsor actual STX fee, and before/after balances. Explain any
   intervening transactions rather than attributing unrelated balance changes.
7. Reject one wallet request and try one expired quote. Confirm neither produces
   a sponsorship or broadcast. Repeat with the other wallet.

Capture screenshots of connection, outflow review, pending receipt, confirmed
receipt, explorer, and safe rejection. Record a 3–5 minute video of the same
wallet-driven flow. Synthetic tests and CLI transactions do not substitute for it.
An independent developer must repeat this from a clean checkout without author
assistance and record time, environment, problems, and fixes.

## Automated browser checks and diagnostics

After building, run `npx playwright install --with-deps` and
`npm run test:browser`. The browser suite uses mocked relay responses and saved
receipts at widths 390 and 1440 in Chromium, Firefox and WebKit. It checks offline
and disconnected states, receipt recovery, terminal/provisional outcomes,
explorer links, no new POSTs during recovery, horizontal overflow and axe checks
on the disconnected page. It does not yet drive a mock signing wallet through
quote issuance and sponsorship, or replace manual keyboard/extension testing.

Client diagnostics store at most 100 timing observations in memory, with only
stage, outcome, and duration; nothing is uploaded or persisted. Relay discovery,
quotes, chain requests, signing, submission and confirmation polling are timed.
The diagnostics helper returns copies; it stores no addresses, transaction IDs,
URLs, error messages, transaction bytes or credentials. This is per-request
timing, not a claim about total chain confirmation latency.

## Isolated fixture build and beta access

`npm run test:browser` now builds to `.next-readiness` with deterministic fixture
trust and runs the actual dashboard with an injected mock wallet and relay.
The normal `.next` production artifact and `.env.local` are preserved. Fixture
screens show a yellow MOCKED DEMO banner; upstream relay/chain proxies point to
an unreachable loopback port and the real faucet is disabled. Never fund the
public fixture accounts. Public deployment validation rejects fixture mode.
Tests verify actual origin signatures and reviewed transaction arguments, denied
post-conditions and `broadcast: false`. Error paths assert sponsorship requests
never occur before safe wallet/quote/balance rejection. Stale simulation response
is mocked after submission and does not produce a successful receipt. Mock
screenshots live in Playwright's `test-results` per test; these are synthetic
review artifacts and must not be presented as live grant evidence.

For manual invited-beta deployment activation and tester credential onboarding,
see [beta access](BETA-ACCESS.md). Spending budgets and loss caps remain separate
implementation requirements. No deployed relay settings were changed here.

## Opt-in live smoke automation after a manual wallet run

The real-wallet connect/sign/broadcast procedure remains **manual**. After it,
export the real UI browser's Playwright-compatible storage state to a protected
local file. Never add that file to git or send its contents in a tester report.
Use `OSSR_LIVE_STORAGE_STATE` for its path. Set `OSSR_LIVE_SMOKE=1`,
`OSSR_LIVE_UI_URL` (the actual HTTPS UI), `OSSR_LIVE_TXID` (0x-prefixed),
`OSSR_LIVE_RECIPIENT`, `OSSR_LIVE_AMOUNT_SATS`, and `OSSR_LIVE_FEE_SATS`.
Optionally set `OSSR_LIVE_RELAY_URL` (defaults to https://relay.ossr.network).
Then run `npm run test:live` in the UI directory. Without opt-in the test skips.

This test uses the existing real receipt, permits GET requests only in the
browser, rejects fixture UI, checks HTTPS and testnet relay identity, verifies
chain success, sponsorship, origin, adapter call, exact recipient and sponsor
sBTC transfers, nonzero actual STX fee, explorer link, and refresh recovery. It
injects no wallet or receipt and performs no new signing/payment. It does not
replace manual proof of the initial zero-STX balance or extension broadcast
behavior. An opt-in run has not yet been performed or claimed.
