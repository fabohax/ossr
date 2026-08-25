# Web application

Future wallet-facing client for quote discovery, origin signing, submission, and status display. It consumes packages from `packages/` and must never handle sponsor keys.

## First interface boundary

The first browser interface should implement only the origin side of the v0.1
testnet flow:

1. Load testnet defaults from `packages/protocol/testnet-manifest.json`.
2. Fetch relay metadata from `GET /v1/info`.
3. Request an exact sBTC transfer quote with `POST /v1/quotes`.
4. Display the transfer amount, sponsor fee in sats, expiry height, adapter
   contract, and total sBTC post-condition before wallet signing.
5. Ask the user's wallet to sign a sponsored `sponsored-transfer` contract call
   as the origin.
6. Submit the origin-signed transaction bytes to `POST /v1/sponsorships`.
7. Poll `GET /v1/sponsorships/{txid}` until a terminal chain status.

The web app must not accept, store, log, or transmit origin private keys, seed
phrases, sponsor private keys, or quote-signing private keys. Local private-key
scripts such as `apps/operator/src/client.ts` are development-only harnesses,
not wallet UI patterns.
