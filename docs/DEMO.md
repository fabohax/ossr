# Day 2 sponsored transaction PoC

This is the Day 2 lowest-level proof. The implementation lives in `packages/stacks/scripts/sponsored-transaction-poc.ts`: an origin signs a sponsored STX transfer, an independent operator adds sponsor authorization and the STX fee, and the operator broadcasts and waits for testnet confirmation.

It intentionally uses a `1` microSTX transfer, not the later sBTC adapter. That isolates Stacks' native sponsored-authorization mechanics before Day 3's operator component and the sBTC contract work. The origin still needs that transfer amount, but pays no network fee.

## Run it

1. Copy `.env.example` to `.env` and supply funded **testnet** keys. The user and sponsor must be distinct; the sponsor needs STX and the user needs the small transfer amount.
2. Run `npm run poc` for an offline signing smoke test. It fetches current nonces but never broadcasts.
3. Run `npm run poc:broadcast` to submit one irreversible testnet transaction. The command prints an explorer URL and exits successfully only once indexer status is `success`.

The script fetches the current user and sponsor nonces immediately before signing. For a real relay, sponsor signing must be serialized so concurrent requests cannot reserve the same sponsor nonce; Day 3 owns that coordinator.

Never use mainnet keys: the script is fixed to `testnet`.
