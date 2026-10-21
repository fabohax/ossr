# USDCx testnet support

OSSR can quote and sponsor atomic USDCx transfers alongside sBTC through the relay API and CLI. The browser transfer screen currently supports sBTC only. The adapter is deployed on testnet at `ST2SY3PZHMVQMYN1W4SBJ9MPHW4P8J01ST7TVQ68X.usdcx-sponsored-transfer-v1` ([deployment transaction](https://explorer.hiro.so/txid/0x279f054da389e61d0bc6584f7e6864661766ea7fc942fd4fed66e8934ec64da1?chain=testnet)), confirmed at Stacks block `639011`. Deployment metadata and the verified source hash are recorded in `deployments/usdcx-testnet.json`.

The canonical token is `ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx`, with fungible asset name `usdcx-token` and six decimals. One USDCx is `1000000` integer base units (`micro-usdcx`). The address is documented by [Stacks](https://docs.stacks.co/learn/bridging/usdcx/contracts) and [Circle](https://www.circle.com/blog/usdcx-on-stacks-now-available-via-circle-xreserve); the precision and asset name were checked against the deployed token source using Hiro's testnet contract-source API.

## Operator setup

1. Use the deployed adapter above, or run `npm run deploy:usdcx` to prepare your own deployment and `npm run deploy:usdcx -- --broadcast` to submit it using `PROTOCOL_PRIVATE_KEY`. The deployment script can fund the deployer with 0.01 testnet STX from `SPONSOR_PRIVATE_KEY` if needed and verifies confirmed status plus published source. The production source pins the canonical token, rejects mainnet, and requires `tx-sponsor?`. The harness under `contracts/testing/` exposes a test-only sponsor argument and must not be deployed as the production adapter.
2. Set `USDCX_ADAPTER_CONTRACT_ADDRESS` to the deployer's testnet address and `USDCX_SPONSOR_FEE_UNITS` to a positive integer from `1` through `10000` (at most 0.01 USDCx). The configured initial fee is `1000` units (0.001 USDCx). For service installations with a protected `.env.local`, public USDCx settings can instead be stored in `.env.usdcx.local`; existing `.env.local` values take precedence. Restart the relay with `npm run operator:serve`, or `sudo systemctl restart ossr-relay.service` for the installed system service. Both settings are required to enable USDCx.
3. Check `/v1/info` for `usdcx-transfer` in `supportedActions` and the separate `usdcx` configuration. Existing quote signing, STX sponsor funding, simulation, nonce tracking, and broadcast configuration still apply.

This initial testnet policy charges a fixed fee in micro-USDCx. Set it using the operator's STX/USD cost plus margin. The sBTC BTC conversion and logarithmic fee curve do not price USDCx; live USDCx price conversion is not implemented. All amounts are integers, so no floating-point rounding enters a quote. The adapter caps transfers at 10 USDCx and sponsor fees at 0.01 USDCx.

## Request a quote

POST `/v1/quotes` with this body (replace addresses):

```json
{
  "assetId": "usdcx",
  "origin": "ST...",
  "recipient": "ST...",
  "amountUnits": "1000000",
  "maxSponsorFeeUnits": "1000"
}
```

An optional `memo` is lowercase hex prefixed by `0x`, up to 34 bytes. Omitting `assetId` keeps the existing sBTC request fields `amountSats` and `maxSponsorFeeSats`.

The signed quote contains action `usdcx-transfer`, the canonical reimbursement contract, unit `micro-usdcx`, decimals `6`, the deployed USDCx adapter, and the committed amount hash. Build a sponsored testnet call to `sponsored-transfer(amount, recipient, sponsor-fee, quote-id, expiry-height, memo)` with origin fee zero and deny-mode post-conditions. Exactly one fungible post-condition must require the origin to send precisely amount plus sponsor fee from the canonical `usdcx::usdcx-token` asset. Submit the origin-signed bytes and quote ID to `/v1/sponsorships` as for sBTC.

The adapter pays the actual sponsor and recipient in one transaction; an error in either transfer rolls both back. USDCx uses this atomic settlement only, and does not invoke the legacy separate sBTC reimbursement worker. Metrics report `usdcxReimbursedUnits` separately from `satsReimbursed`; local activity records expose `assetId`, `amountUnits`, and `sponsorFeeUnits`.

## CLI transfer

Fund the user with testnet USDCx using the [Stacks bridge guide](https://docs.stacks.co/more-guides/bridging-usdcx). Set `USER_PRIVATE_KEY`, `RECIPIENT_ADDRESS`, `OSSR_API_URL`, and:

```dotenv
OSSR_ASSET_ID=usdcx
USDCX_TRANSFER_AMOUNT_UNITS=1000000
USDCX_MAX_SPONSOR_FEE_UNITS=1000
```

Run `npm run operator:client -- --wait`. The CLI is a development client using the configured relay. Production wallet clients should independently pin the relay identity/public key and verify the signed quote before user approval, as the existing browser sBTC flow does.

## Local verification

Run `npm run typecheck`, `npm run test:relay-policy`, `npm run test:quote-store`, and `npm run test:contracts`. The USDCx contract harness tests sponsor presence, expiry, amount/fee bounds, origin restrictions, settlement, and full rollback. Relay tests cover asset metadata, opt-in configuration, base-unit parsing, fee limits, wrong adapters/assets, and exact outflow validation before simulation. A live acceptance transfer requires deployment and a funded testnet user.
