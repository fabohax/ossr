# P0 implementation and validation

October 3, 2026. Testnet prototype only.

## Configure trust before signing

Set these public build-time variables in `ossr-ui/.env.local`, then rebuild:

```
NEXT_PUBLIC_OSSR_RELAY_URL=https://your-relay.example
NEXT_PUBLIC_STACKS_API_URL=https://api.testnet.hiro.so
NEXT_PUBLIC_OSSR_QUOTE_PUBLIC_KEY=<compressed secp256k1 public key, with or without 0x>
NEXT_PUBLIC_OSSR_RELAY_ID=<operator-configured relay ID>
NEXT_PUBLIC_OSSR_QUOTE_KEY_ID=<operator-configured quote key ID>
NEXT_PUBLIC_OSSR_POLICY_VERSION=<operator-configured policy version>
NEXT_PUBLIC_OSSR_ADAPTER_CONTRACT=<testnet adapter principal>
NEXT_PUBLIC_OSSR_SBTC_CONTRACT=<testnet sBTC token principal>
NEXT_PUBLIC_OSSR_SPONSOR_PRINCIPAL=<testnet sponsor address>
```

Obtain the public key and identities from the operator through a trusted channel.
Do not copy an untrusted quote response into deployment configuration. All seven
trust fields are required. The UI fails closed when any is missing. Relay metadata
is used for fee previews, never as the source of quote trust.

## Implemented behavior

The browser reproduces the relay SIP-018 domain and full Clarity quote tuple,
verifies the RSV signature and recovery key, and binds the arguments hash to the
reviewed intent. It checks testnet identity, policy, adapter, asset, sponsor,
positive integer sats, memo bytes, maximum fee, chain height, and current balance.
Every transfer edit invalidates the quote. Quotes show a block countdown and
require a separate approval button. Freshness, account identity, and balances are
checked again after nonce lookup, immediately before the signing prompt, and
before submitting. Quote integers must be canonical strings within the Clarity
uint range, and fees must be positive.

Leather and Xverse are the only selectable providers. Both use a prebuilt
sponsored transaction with `stx_signTransaction` and `broadcast: false`. Returned
bytes must verify the origin signature and match the reviewed origin, network,
contract, function, arguments and exact Deny post-condition. A transaction ID
returned by the wallet instead of raw bytes is rejected. Sponsor authorization
must remain empty. This is an implemented compatibility path, not live extension
evidence.

The last submitted transaction ID, relay URL, and reviewed quote/intent persist
in localStorage. Refresh resumes polling the original relay; account changes do
not erase the receipt. Explorer links are available immediately after broadcast.
Unknown/not-found results keep polling; confirmed, aborted and dropped results
have distinct outcomes. A 15-minute wait or relay outage explains that the
transaction may already be broadcast and must not be resubmitted blindly. Storage
failures leave the in-memory receipt and tell the user to save its explorer link.

## Local validation

From the repository root:

```
npm run test:ui-quotes
npm run typecheck --prefix ossr-ui
npm run build --prefix ossr-ui
```

Tests verify quotes issued by the actual relay implementation, including absent,
empty, and populated memos and prefixed public keys. The fixture also uses the
relay's production quote tuple/domain and signing function.
Tests reject every top-level signed-field mutation, nested asset mutations,
changed intent, expired/future height, insufficient balance, invalid inputs,
unsigned wallet bytes, wrong origin and altered wallet call. Browser checks cover
page rendering, disconnected signing disabled, field guidance, and receipt
restoration. No private keys or signed transaction bytes are persisted.

## Outstanding live acceptance

For each wallet, record extension version, browser version, testnet account,
returned raw bytes behavior and absence of wallet broadcast. Record unsupported
method/public-key errors precisely. Do not mark compatibility complete until
these tests run with installed extensions.

For the public demo, connect a funded testnet-sBTC account with zero STX, record
user/recipient/sponsor balances, review the verified quote and exact outflow,
capture wallet approval, submit, refresh, and wait for confirmation. Record the
transaction ID, explorer URL, exact recipient payment, sponsor reimbursement and
sponsor STX fee. Link that evidence from `docs/roadmaps/ROADMAP-PREGRANT.md`.
The existing CLI testnet run does not substitute for this UI acceptance run.
