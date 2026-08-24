# Clarinet Devnet

This repository includes a Clarinet harness for local contract checks, simnet
tests, and devnet deployment planning.

## Commands

```sh
npm run clarinet:check
npm run test:contracts
npm run devnet:generate
npm run devnet:start
npm run devnet:smoke
```

`npm run devnet:generate` writes `deployments/default.devnet-plan.yaml` from
`settings/Devnet.toml`.

Run `npm run devnet:smoke` in another terminal after `npm run devnet:start`
prints `Local Devnet network ready`. The smoke script mints mock sBTC, calls the
local sponsored-transfer harness, waits for both transactions, and verifies the
user, recipient, and sponsor balances.

## Contracts

The devnet/simnet manifest deploys:

- `mock-sbtc-token`
- `operators-registry`
- `sbtc-sponsored-transfer-v1`

The production adapter in `contracts/sbtc-sponsored-transfer-v1.clar` pins the
canonical testnet sBTC contract. The Clarinet manifest points the same contract
name at `contracts/testing/sbtc-sponsored-transfer-v1.clar`, which uses the
local mock token so the transfer and reimbursement path can execute locally.

## Linux Docker Firewall

On this machine, UFW sets the host `INPUT` policy to `DROP`, which prevents
Clarinet's bridge-network containers from reaching host-published devnet
services. Devnet requires container-to-host access to:

- `20445` for the Clarinet orchestrator callback/proxy.
- `18443` for Bitcoin RPC.
- `18444` for Bitcoin P2P.

If containers cannot reach `host.docker.internal`, add narrow host firewall
rules for the current devnet subnet before starting devnet:

```sh
docker run --rm --privileged --network host alpine:latest sh -lc '
  apk add --no-cache iptables >/dev/null
  iptables -I INPUT 1 -p tcp -s 172.19.0.0/16 --dport 20445 -j ACCEPT
  iptables -I INPUT 1 -p tcp -s 172.19.0.0/16 --dport 18443 -j ACCEPT
  iptables -I INPUT 1 -p tcp -s 172.19.0.0/16 --dport 18444 -j ACCEPT
'
```

The subnet can be checked while devnet is running with:

```sh
docker network inspect ossr.devnet --format '{{(index .IPAM.Config 0).Subnet}}'
```

## Current Local Status

Verified contract checks:

```sh
npm run clarinet:check
npm run test:contracts
```

Both commands pass.

Verified full devnet startup with:

```sh
npm run devnet:generate
npm run devnet:start
```

After applying the firewall rules above, devnet reached `Local Devnet network
ready`, the node reported `is_fully_synced: true`, and these contracts deployed:

- `ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.mock-sbtc-token`
- `ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.operators-registry`
- `ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.sbtc-sponsored-transfer-v1`

`npm run devnet:smoke` was also verified against the live devnet. It confirmed
one mint transaction and one `sponsored-transfer-for-test` transaction, then
checked these balance deltas:

- user: `+890` mock sBTC
- recipient: `+100` mock sBTC
- sponsor: `+10` mock sBTC
