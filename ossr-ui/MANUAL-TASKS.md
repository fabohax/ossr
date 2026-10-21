# Tasks requiring manual execution

These tasks remain open. Documentation, mocked screenshots, CLI transactions and
local tests do not establish live wallet or operational acceptance.

| ID | Owner role | Manual action | Evidence to record |
|---|---|---|---|
| M01 | Wallet tester | Run Leather and Xverse on testnet, inspect the signing prompt and verify the extension does not broadcast. | Extension/browser/OS versions, origin-only raw response observation without publishing signed bytes, precise compatibility failures; account/network switches and disconnect must invalidate dependent quote/balance state. |
| M02 | Wallet tester | Complete a real UI transfer from a funded sBTC account with zero STX. | Before/after balances, prompt, reviewed outflow, txid, confirmation, recipient amount, sponsor reimbursement and actual STX fee. |
| M03 | Deployer | Configure/deploy actual HTTPS UI and relay origins, trusted identity and CORS. | Deployment revision, HTTPS/mixed-content/OPTIONS checks and exact public origins. |
| M04 | Accessibility reviewer | Walk the whole flow using keyboard and assistive technology, then check real extension overlays and mobile wallet handoff. | Focus order/visibility, announcements, labels, layout and browser/device observations. Automated axe covers fixture states but does not replace this. |
| M05 | Developer + wallet tester | Test the security headers with installed wallets; approve a restrictive script/connect policy only after the needed origins and nonce handling are verified. | Header/CSP behavior, extension compatibility and any policy exceptions. Baseline headers are implemented. |
| M06 | Wallet tester | Capture grant-review screenshots and a 3–5 minute wallet-driven video including safe rejection. | Links to actual wallet evidence. Fixture screenshots must remain labeled synthetic. |
| M07 | Independent developer | Ask an independent developer to follow the setup/live procedure from a clean checkout without author assistance. | Environment, elapsed time, problems and fixes; independently recorded txid. |
| M08 | Operator | Deploy a synchronized protected simulation node, one exclusively owned sponsor process, automatic restart and persistent stores. Perform backup and restoration rehearsal. | Service configuration, simulation height/authentication, storage paths, restart and restore observations. |
| M09 | Operator + tester | Execute the live recovery drills: signing/broadcast interruption, process restart, RPC timeout, stale simulation, expiry, concurrency and duplicate clicks. | Quote/nonce/transaction reconciliation, no duplicate payment or conflicting signatures, actual chain outcomes. |
| M10 | Operator | Activate beta access and distribute unique credentials to invited wallets using a private channel. Revoke one and check rejection. | Allowlist, credential-origin binding, request-limit and revocation outcomes, without recording credentials. Local access controls are implemented. |
| M11 | User + operator | Choose beta policy values and activate reviewed spending/transfer limits and alerts after review. | Transfer/wallet/day limits, STX budget, loss cap, accounting and alert observations. Local controls and ledger exist; deployed settings and live evidence remain pending. |
| M12 | Operator + invited testers | Onboard 5–10 invited testers for at least two weeks and reconcile at least 100 confirmed transfers. | Tester/date counts, all submitted/aborted/unknown chain outcomes, actual costs and reimbursements, failures and recovery. |

Use [deployment runbook](DEPLOYMENT-RUNBOOK.md), [beta access](BETA-ACCESS.md),
[compatibility matrix](COMPATIBILITY.md) and [evidence template](EVIDENCE-TEMPLATE.md).

## Work that remains programmable

Durable per-wallet/day transfer limits, sponsor STX commitments, unreimbursed
exposure caps, exact-payment accounting and loopback alert signals now have local
implementation and tests. Policy amounts and deployed activation await user input.
External alert delivery still needs an operator-selected monitoring destination.
A static-compatible script/connect CSP is implemented; installed-extension
compatibility and any future nonce hardening need their own evidence. Keep these as **MIXED** rather than declaring the coding portions manual.
