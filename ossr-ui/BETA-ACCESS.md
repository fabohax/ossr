# Invited testnet access

The relay now has an opt-in wallet allowlist and authenticated request limit.
Deployment activation and invitation distribution are **manual**. This does not
complete beta spending limits, accounting, alerts, or sustained-use acceptance.

Set `OSSR_BETA_ACCESS=true`, and supply `OSSR_BETA_WALLET_TOKENS` as a secret JSON
object mapping each invited canonical testnet principal to a different random
credential. Generate each credential with at least 32 random bytes encoded as
base64url (43 characters). Set `OSSR_BETA_REQUESTS_PER_MINUTE` (default 30).
Missing, empty, malformed, mainnet or duplicated credentials fail startup.
Restart the relay to change/revoke credentials; protect its environment file.
Do not put credentials in source, URLs, screenshots or public UI build variables.

Distribute each credential through an authenticated private channel to that
wallet's tester. In the UI, Advanced → Invited beta access credential accepts it.
The credential remains in memory for that exact relay endpoint and clears on
refresh, endpoint change, or disconnect. Changing an account requires its own
credential; a mismatch is rejected by the relay. Use HTTPS for deployment.

The HTTP relay authenticates POST `/v1/quotes`, `/v1/sponsorships` and the legacy
`/v1/sponsor` before reading the body or processing/simulating a transaction.
Credentials authorize only their associated origin, and a per-wallet minute
bucket applies to these requests. Signature verification still checks that the
submitted `user` is the cryptographically verified transaction origin, and
allowlist enforcement also applies to internal quote/sponsor methods. Public
info, status and health reads remain available for recovery. CORS must allow the
Authorization header for direct cross-origin requests. Underlying node simulation
RPC must separately use its protected authentication; it must not be exposed
as an unauthenticated public bypass.

Request counters are process-local and reset on restart; they are abuse limits,
not durable payment/spending budgets. They do not establish multi-process safety.
Credentials authenticate access; they never authorize a transfer without a
valid origin signature, verified quote and successful simulation.

Run `npm run test:beta-access` at the repository root. Local unit and HTTP tests
cover unknown credentials, wallet mismatch, all write endpoints, rate limit,
empty configuration, and rejection before quote/sponsorship processing.

**Manual acceptance:** configure the deployed relay with invited test wallets;
verify an uninvited wallet and a wrong credential cannot request a quote or
simulation; verify each credential works only for its wallet; record 429 and
recovery at the next minute; revoke one credential and verify rejection; run the
wallet-driven success procedures. Record observations without recording tokens.

## Persistent operator pause

The CLI uses `OSSR_PAUSE_FILE` (default `.ossr/paused`). Creating the file blocks
new quote and sponsorship work, including after a process restart. Status and
health reads remain available. Removing it resumes new work only after operator
reconciliation. Unreadable pause state fails closed. The info endpoint reports
sponsorships disabled while paused; the UI disables approval. This is a local
operator control, not a publicly accessible mutation endpoint. Creating a flag
does not cancel a transaction already being processed or broadcast.

## Durable limits and chain accounting

Set `OSSR_BETA_BUDGETS=true` only after choosing all five required positive integer
limits: `OSSR_BETA_MAX_TRANSFER_SATS` (recipient amount),
`OSSR_BETA_WALLET_DAILY_SATS` and `OSSR_BETA_DAILY_SATS` (amount plus sBTC fee),
`OSSR_BETA_DAILY_STX_MICROSTX` (sponsor fee commitments), and
`OSSR_BETA_LOSS_CAP_MICROSTX` (unreimbursed/unknown sponsor STX exposure).
No deployment amounts were chosen or activated. With budget controls enabled,
USDCx is rejected because it requires separate asset-specific limits/accounting.
A closed beta must activate both access controls and budget controls.

The JSON ledger is `OSSR_BETA_LEDGER_PATH` (default `.ossr/beta-ledger.json`). Keep
it with the durable quote and nonce stores, and back up/restore all three while
the relay is stopped. One process must own the stores and sponsor account.
Reservations are serialized and atomically replaced with mode 0600. These local
stores are not safe for multiple processes/hosts and do not promise power-loss
storage durability beyond the filesystem; perform the backup/restart drill.

Daily commitment limits reset at midnight in `OSSR_BETA_TIME_ZONE` (default
America/Lima). They count new sponsorship commitments on their reservation day,
not the later chain-confirmation day. Outflow reservations remain conservative
for aborted and unknown work. Unknown STX exposure carries across days. The
unreimbursed cap measures sponsor fees without proven exact sBTC reimbursement;
it is not a market-price conversion or a guarantee of economic profit.

Before sponsor signing, transfer, wallet/day, relay/day, daily STX and total
unreimbursed exposure limits are checked and reserved durably. A signed quote's
transaction ID is immutable. After any signature is prepared, budget-controlled
processing is retained across simulation or broadcast failure; another distinct
sponsorship for that quote requires operator investigation and is not retried
implicitly. Unknown outcomes never release exposure because a timeout elapsed.

Configure `OSSR_BETA_ACCOUNTING_TOKEN` as a separate random 32-byte base64url
operator credential (never an invited-wallet token). Read GET `/v1/beta/accounting`
**directly over loopback only**, with that Bearer credential to reconcile pending IDs and
retrieve ledger entries plus alert codes. Forwarded/proxied requests are rejected. Configure your local monitoring to poll
this endpoint and surface alerts; push/email delivery has not been configured.
The endpoint reports stuck/ambiguous commitments (default 10 minutes), unhealthy
or low sponsor balance using `OPERATOR_MINIMUM_BALANCE_MICROSTX`, simulation
failure codes and accounting mismatches. Unreachable chain RPC preserves reserved
exposure. Status polling also reconciles known IDs. The operator endpoint rechecks settled
IDs too; changed or unavailable settlement evidence records an accounting alert
and restores conservative exposure until a valid receipt is reconciled.

Accounting accepts complete chain receipts matching the txid, origin and sponsor.
It records actual STX fee, actual recipient payment and exact sBTC reimbursement,
including zero payment/reimbursement on chain aborts. It rejects unexpected asset
movements, wrong amounts, truncated events and changes to already settled
receipts. Missing, changed, or ambiguous evidence remains exposed for operator
investigation. Do not erase entries or restore stale stores just to unblock a cap.

Run `npm run test:beta-budget` at the root. Tests cover concurrent limits, restart
persistence, daily reset, carried exposure, idempotency, immutable signed IDs,
success/abort accounting, corrupt/truncated receipts and integrated relay rejection
before an additional broadcast. Actual policy activation, alert delivery, complete
live reconciliation and failure drills remain **manual acceptance** tasks.
