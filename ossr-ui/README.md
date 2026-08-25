# OSSR UI

Next.js testnet interface for the origin side of OSSR v0.1.

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

```sh
npm install
npm run dev
```

Set `NEXT_PUBLIC_OSSR_RELAY_URL` to point at a running OSSR relay. The default
is `http://127.0.0.1:3000`.
