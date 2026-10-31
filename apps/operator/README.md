# OSSR Operator CLI

This repository contains the standalone OSSR operator CLI and relay service for sponsoring and broadcasting Stacks transactions on testnet or mainnet. Mainnet mode is limited to the deployed OSSR sBTC adapter and does not by itself establish production readiness.

The operator owns a sponsor wallet, checks wallet health, tracks durable nonce reservations, signs sponsored transactions, and exposes a local HTTP relay for quote and sponsorship flows. The implementation is centered around the operator core in `src/operator.ts`, the HTTP API in `src/api.ts`, and the CLI entrypoint in `src/cli.ts`.

## What this repo includes

- Sponsor wallet management and sponsorship flow
- Durable nonce tracking and reconciliation
- Quote and sponsorship storage
- Local relay API for quote and sponsorship requests
- Reimbursement and operator registry helpers
- A lightweight CLI for health, status, and relay startup

## Requirements

- Node.js 20+
- For testnet, a sponsor private key in `SPONSOR_PRIVATE_KEY`; for mainnet, a separate key in `MAINNET_SPONSOR_PRIVATE_KEY`
- A matching Stacks API endpoint for the selected network
- A simulation endpoint for pre-broadcast validation; mainnet startup requires `MAINNET_STACKS_SIMULATION_API_URL`
- A `.env.local` or `.env` file for local configuration

## Configuration

Create a local environment file for the operator before running it:

```bash
cp .env.example .env.local
chmod 600 .env.local
```

If you do not have an example file in this repo, create `.env.local` directly with the required variables, for example:

```bash
SPONSOR_PRIVATE_KEY=...
STACKS_API_URL=https://...
OPERATOR_MINIMUM_BALANCE_MICROSTX=0
NONCE_STORE_PATH=.ossr/nonces.json
```

For mainnet set `STACKS_NETWORK=mainnet`. Use the separate `MAINNET_*` keys,
API endpoint, quote key, and durable stores in `.env.example`; testnet signing
keys are never used as a fallback. Mainnet also requires a distinct quote key,
a Core simulation endpoint, and live STX/BTC cost pricing. The relay pins the
deployed mainnet adapter and canonical sBTC token and disables USDCx.

Additional settings may include:

- `STACKS_SIMULATION_API_URL`
- `STACKS_SIMULATION_AUTH_TOKEN`
- `QUOTE_PRIVATE_KEY`
- `OPERATOR_PORT`
- `OPERATOR_HOST`
- `REIMBURSEMENT_PAYER_PRIVATE_KEY`
- `OPERATOR_REGISTRY_PATH`
- `OPERATOR_HEARTBEAT_TOKEN` (required to update the registry; heartbeat is loopback-only)

## CLI usage

The CLI entrypoint is defined in `src/cli.ts`. The usual flows are:

```bash
# health check
node --loader tsx src/cli.ts health

# transaction status
node --loader tsx src/cli.ts status <64-character-txid>

# nonce status
node --loader tsx src/cli.ts nonce-status

# reconcile durable reservations
node --loader tsx src/cli.ts nonce-reconcile

# start the relay API
node --loader tsx src/cli.ts serve
```

The repository is intentionally designed around explicit environment variables and durable local stores so it remains easy to run in isolated testnet setups.

## Relay API overview

The relay can expose a local HTTP API for a sponsor flow that includes:

- `GET /health/live`
- `GET /health/ready`
- `GET /v1/info`
- `GET /v1/metrics` (loopback-only)
- `POST /v1/quotes`
- `POST /v1/sponsorships`
- `GET /v1/sponsorships/<txid>`

The API validates transaction structure, quote state, sponsor balance, and simulation results before broadcasting. It persists quote and sponsorship state to JSON stores under `.ossr/` by default.

Bind the service to `127.0.0.1` and publish it through a TLS reverse proxy. Metrics, activity, beta accounting, and registry heartbeat operations are local-only; heartbeat also requires `OPERATOR_HEARTBEAT_TOKEN`. Configure `OSSR_CORS_ALLOWED_ORIGINS` with only the exact browser origins that need access. Apply connection and request rate limits at the public proxy/firewall.

## Operational notes

- The sponsor nonce is durable and reconciled against chain state.
- Failed or ambiguous broadcasts are not silently released without reconciliation.
- Simulation must be trusted and current; stale simulation responses are treated as not ready.
- Quotes and reimbursements are stored locally by default and should be protected with the same care as private keys.

## Repository layout

```text
src/
  api.ts            HTTP relay implementation
  cli.ts            CLI entrypoint
  operator.ts       sponsor wallet and transaction logic
  quote-store.ts    quote persistence
  nonce-store.ts    nonce persistence
  reimbursement.ts reimbursement logic
  registry.ts       operator registry logic
README.md
```

## License

This project is licensed under the terms in the repository license file.
