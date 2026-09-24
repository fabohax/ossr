# OSSR UI

Next.js testnet interface for the origin side of OSSR v0.1.

The prioritized work required for a grant-reviewable interface is tracked in
[GRANT-READINESS.md](GRANT-READINESS.md).

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

Open `http://localhost:3000`. The dashboard points to the relay on
`http://127.0.0.1:3002` by default. To override it, create
`ossr-ui/.env.local` before running `npm run dev`:

```dotenv
NEXT_PUBLIC_OSSR_RELAY_URL=http://127.0.0.1:3002
```

Next.js reads this UI-specific file from `ossr-ui`; the relay continues to read
the root `.env.local`. When opening the UI through a LAN hostname or address,
bind the relay with `OPERATOR_HOST=0.0.0.0` and add the UI's exact origin to the
root `OSSR_CORS_ALLOWED_ORIGINS` value.

Browsing the UI and fetching relay metadata do not require a synchronized local
Stacks node. Submitting a sponsorship does: if the simulation follower is
behind the public testnet tip, the relay intentionally returns HTTP 503 with
`SIMULATION_STALE`.
