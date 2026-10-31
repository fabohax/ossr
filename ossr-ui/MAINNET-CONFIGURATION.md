# Mainnet UI configuration

Set these public values at build time for a Stacks mainnet UI deployment:

```dotenv
OSSR_DEPLOYMENT=public
NEXT_PUBLIC_OSSR_NETWORK=mainnet
STACKS_API_URL=https://stacks-node-api.mainnet.stacks.co
NEXT_PUBLIC_OSSR_ADAPTER_CONTRACT=SP17M2KWEK37A5MPDTMWGXJFGJCY41JVQKVK828TQ.sbtc-sponsored-transfer-mainnet-v1
NEXT_PUBLIC_OSSR_SBTC_CONTRACT=SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
NEXT_PUBLIC_OSSR_SPONSOR_PRINCIPAL=<mainnet relay sponsor address>
NEXT_PUBLIC_OSSR_RELAY_ID=<mainnet relay id>
NEXT_PUBLIC_OSSR_QUOTE_KEY_ID=<mainnet quote key id>
NEXT_PUBLIC_OSSR_POLICY_VERSION=<mainnet policy version>
NEXT_PUBLIC_OSSR_QUOTE_PUBLIC_KEY=<mainnet quote public key>
OSSR_RELAY_PROXY_URL=<mainnet relay HTTPS URL>
```

The adapter and sBTC values are pinned by public-build validation. The UI
verifies the relay's reported network against `NEXT_PUBLIC_OSSR_NETWORK`, uses
the matching chain ID for origin-only sponsored transactions and quote
signatures, and uses the corresponding Stacks API for balance and block-height
lookups. Mainnet builds offer sBTC only and omit the testnet faucet.

The relay must itself support mainnet, including mainnet transaction decoding,
simulation, quoting and sponsorship. This repository's operator relay is still
testnet-only, so its `/v1/info` response will keep the mainnet UI in a safe,
unavailable state until mainnet relay support is implemented and deployed. Do
not publish this build against a testnet relay.
