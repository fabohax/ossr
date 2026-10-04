# OSSR UI

Next.js testnet interface for the origin side of OSSR v0.1.

The prioritized work required for a grant-reviewable interface is tracked in
[GRANT-READINESS.md](GRANT-READINESS.md).

Configure the trusted relay key and identity before signing, using
[P0-VALIDATION.md](P0-VALIDATION.md#configure-trust-before-signing). These public
values must come from a trusted operator channel. Restart development or rebuild
the deployment after changing them. Run `npm run test:ui-quotes` from the
repository root to verify quote and origin-signing safeguards.

## Wallet model

The MVP should use an existing browser wallet through Stacks Connect. The UI
requests:

- `getAddresses` to discover the user's STX address.
- `stx_callContract` with `sponsored: true` to ask the wallet for an
  origin-signed, not-yet-broadcast contract-call transaction.

The relay then receives those raw signed bytes at `POST /v1/sponsorships`,
adds the sponsor authorization, pays the STX fee, and broadcasts.

Building a custom browser extension is not required for the OSSR MVP. A custom
wallet extension would inject a provider object into the page, implement
`.request(method, params)`, register itself for wallet discovery, protect keys
in extension storage/background context, and handle prompts for address
sharing and signing. That is useful later if OSSR wants its own wallet, but the
first interface should prove compatibility with installed wallets such as
Leather or Xverse.

## Social sharing metadata

The generated cover in `app/opengraph-image.jpg` is shared by Open Graph and
Twitter previews through Next.js file-based metadata. The accompanying `.alt.txt`
files provide accessible descriptions. Generation details are in
`assets/og-cover-prompt.md`.

Set `NEXT_PUBLIC_SITE_URL` to the public origin (for example,
`https://your-domain.example`) when deploying to a custom domain. Otherwise,
metadata uses the Vercel production/deployment hostname or localhost in development.

## Local development

The UI and relay run as separate processes. Start the relay from the repository
root first:

```sh
npm install
npm run operator:serve
```

Verify that `http://127.0.0.1:3002/health/ready` returns HTTP 200. Then, in a
second terminal, start the UI:

```sh
cd ossr-ui
npm install
npm run dev
```

Open `http://localhost:3000`. The dashboard uses `https://relay.ossr.network`
by default through the same-origin `/relay` proxy, so localhost and LAN access
do not require relay CORS changes. To use a local operator instead, create
`ossr-ui/.env.local` before running `npm run dev`:

```dotenv
NEXT_PUBLIC_OSSR_RELAY_URL=/relay
OSSR_RELAY_PROXY_URL=http://127.0.0.1:3002
```

Next.js reads this UI-specific file from `ossr-ui`; the relay continues to read
the root `.env.local`. When opening the UI through a LAN hostname or address,
bind the relay with `OPERATOR_HOST=0.0.0.0` and add the UI's exact origin to the
root `OSSR_CORS_ALLOWED_ORIGINS` value.

Browsing the UI and fetching relay metadata do not require a synchronized local
Stacks node. Submitting a sponsorship does: if the simulation follower is
behind the public testnet tip, the relay intentionally returns HTTP 503 with
`SIMULATION_STALE`.

### Request testnet sBTC

The transfer modal offers **Request Testnet sBTC** after connecting a testnet wallet. The wallet signs a five-minute request; `/api/testnet-sbtc` verifies ownership and sends exactly 10 sats from the server sponsor, which also pays STX fees. The balance updates after confirmation on its existing refresh interval.

Set `SBTC_FAUCET_PRIVATE_KEY` (or `SPONSOR_PRIVATE_KEY`) in `ossr-ui/.env.local` or the server environment. Never use a `NEXT_PUBLIC_` variable for this key. Fund its testnet address with sBTC and STX. `SBTC_FAUCET_CONTRACT` defaults to `SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token`.

Claims are limited to once per address every 24 hours. Set `SBTC_FAUCET_DATA_DIR` to a persistent directory (default `.sbtc-faucet`). This endpoint requires a Node server with persistent writable storage; ephemeral serverless storage does not preserve limits. Requests serialize using an exclusive sponsor lock, and claim receipts are saved before broadcasting so retries cannot pay twice. If the server crashes while holding `sponsor.lock`, inspect the saved receipts and chain status before removing the lock. Run one faucet instance per sponsor and coordinate other services using the same key to avoid nonce conflicts.

Run the mocked endpoint checks with `../node_modules/.bin/tsx lib/testnet-sbtc.test.ts` from `ossr-ui`.
