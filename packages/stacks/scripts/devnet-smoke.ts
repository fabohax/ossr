#!/usr/bin/env tsx
import {
  AnchorMode,
  broadcastTransaction,
  bufferCV,
  cvToString,
  fetchCallReadOnlyFunction,
  fetchNonce,
  getAddressFromPrivateKey,
  makeContractCall,
  noneCV,
  PostConditionMode,
  standardPrincipalCV,
  uintCV,
} from '@stacks/transactions';

const network = 'testnet' as const;
const apiUrl = (process.env.STACKS_API_URL ?? 'http://localhost:3999').replace(/\/$/, '');

const deployerKey = process.env.DEVNET_DEPLOYER_PRIVATE_KEY ?? '753b7cc01a1a2e86221266a154af739463fce51219d97e4f856cd7200c3bd2a601';
const userKey = process.env.DEVNET_USER_PRIVATE_KEY ?? '7287ba251d44a4d3fd9276c88ce34c5c52a038955511cccaf77e61068649c17801';
const deployer = getAddressFromPrivateKey(deployerKey, network);
const user = getAddressFromPrivateKey(userKey, network);
const recipient = process.env.DEVNET_RECIPIENT_ADDRESS ?? 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG';
const sponsor = process.env.DEVNET_SPONSOR_ADDRESS ?? 'ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC';
const contractAddress = process.env.DEVNET_CONTRACT_ADDRESS ?? deployer;

const client = { baseUrl: apiUrl };

async function waitForApi(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const info = await (await fetch(`${apiUrl}/v2/info`)).json() as { is_fully_synced?: boolean };
      if (info.is_fully_synced) return;
    } catch {
      // keep polling
    }
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  throw new Error(`Devnet API is not ready at ${apiUrl}. Start it with npm run devnet:start.`);
}

async function waitForTx(txid: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${apiUrl}/extended/v1/tx/${txid}`);
    if (response.ok) {
      const body = await response.json() as { tx_status?: string; tx_result?: unknown };
      if (body.tx_status === 'success') return;
      if (body.tx_status?.startsWith('abort_')) {
        throw new Error(`Transaction ${txid} failed: ${JSON.stringify(body.tx_result)}`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for ${txid}`);
}

async function call(
  contractName: string,
  functionName: string,
  functionArgs: Parameters<typeof makeContractCall>[0]['functionArgs'],
  senderKey: string,
): Promise<string> {
  const sender = getAddressFromPrivateKey(senderKey, network);
  const tx = await makeContractCall({
    contractAddress,
    contractName,
    functionName,
    functionArgs,
    senderKey,
    nonce: await fetchNonce({ address: sender, network, client }),
    fee: 10_000n,
    network,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
  });
  const result = await broadcastTransaction({ transaction: tx, network, client });
  if (!('txid' in result)) throw new Error(`Broadcast rejected: ${JSON.stringify(result)}`);
  await waitForTx(result.txid);
  return result.txid;
}

async function balance(owner: string): Promise<string> {
  const result = await fetchCallReadOnlyFunction({
    contractAddress,
    contractName: 'mock-sbtc-token',
    functionName: 'get-balance',
    functionArgs: [standardPrincipalCV(owner)],
    senderAddress: deployer,
    network,
    client,
  });
  return cvToString(result);
}

function parseOkUint(value: string): bigint {
  const match = /^\(ok u(\d+)\)$/.exec(value);
  if (!match) throw new Error(`Expected an ok uint balance, received ${value}`);
  return BigInt(match[1]);
}

function stringify(value: unknown): string {
  return JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
}

async function main(): Promise<void> {
  await waitForApi();

  const before = {
    user: parseOkUint(await balance(user)),
    recipient: parseOkUint(await balance(recipient)),
    sponsor: parseOkUint(await balance(sponsor)),
  };

  const mintTx = await call('mock-sbtc-token', 'mint', [uintCV(1_000n), standardPrincipalCV(user)], deployerKey);
  const transferTx = await call(
    'sbtc-sponsored-transfer-v1',
    'sponsored-transfer-for-test',
    [
      uintCV(100n),
      standardPrincipalCV(recipient),
      standardPrincipalCV(sponsor),
      uintCV(10n),
      bufferCV(Buffer.alloc(32, 1)),
      uintCV(1_000_000n),
      noneCV(),
    ],
    userKey,
  );

  const after = {
    user: parseOkUint(await balance(user)),
    recipient: parseOkUint(await balance(recipient)),
    sponsor: parseOkUint(await balance(sponsor)),
  };

  const expected = {
    user: before.user + 890n,
    recipient: before.recipient + 100n,
    sponsor: before.sponsor + 10n,
  };

  if (after.user !== expected.user || after.recipient !== expected.recipient || after.sponsor !== expected.sponsor) {
    throw new Error(`Unexpected balance deltas after smoke test: ${stringify({ before, after, expected })}`);
  }

  console.log(stringify({
    status: 'ok',
    apiUrl,
    contractAddress,
    mintTx,
    transferTx,
    before,
    after,
  }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
