# Compatibility and limitations

| Capability | Current evidence and limitation |
|---|---|
| Leather and Xverse | Connection and origin-only transaction checks have local tests. Complete wallet-driven public testnet runs and extension versions remain unverified. |
| Other wallets | Not offered by the connection selector. No compatibility claim. |
| Chromium, Firefox, WebKit | 114 fixture checks passed across all three engines at 390 and 1440 pixels, including quote/sign/submit and rejection paths; installed extension behavior needs manual evidence. |
| Mobile | Responsive layout is intended; mobile wallet handoff remains unverified. |
| Network | Stacks testnet only; no production/mainnet/audit claim. |
| Quote trust | Pinned public key and relay identity; signed fields, intent, expiry, fee and balance checked before signing and submission. |
| Relay outage | Requests time out; saved submitted receipt remains available and polling resumes. Do not resubmit an ambiguous payment. |
| Persistence | Local browser storage; clearing storage or changing device loses the local receipt. Save the explorer link. |
| Chain drop/unknown | Continue checking; a mempool drop is not proof that payment cannot confirm. |
| Signing | Returned bytes must match the origin, network, exact arguments, deny post-condition and blank sponsor signature. This does not prove an extension never broadcasts internally. |
| Beta operations | Opt-in allowlist, authenticated access, durable budgets/accounting, pause and local alert signals are implemented and locally tested. Policy amounts, deployment activation, monitoring delivery, backups and sustained-use evidence remain manual. |

See [deployment and smoke-test runbook](DEPLOYMENT-RUNBOOK.md) and
[evidence template](EVIDENCE-TEMPLATE.md). Grant-ready status remains pending.

Fixture mode is visibly labeled, disables real faucet payments, and builds separately
from normal testnet. The static CSP permits inline hydration scripts/styles; wallet
extension compatibility under these headers still needs manual evidence. Budget-controlled
beta is sBTC-only; USDCx requires its own policy and ledger.
