#!/usr/bin/env tsx
import { config as loadEnv } from 'dotenv';
import { makeContractCall, uintCV, bufferCV, makeUnsignedTransaction, serializeCV } from '@stacks/transactions';
import { getAddressFromPrivateKey, fetchNonce, broadcastTransaction } from '@stacks/transactions';
loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

let network: any = 'testnet';
const broadcast = process.argv.includes('--broadcast');

function required(name: string): string { const v = process.env[name]?.trim(); if (!v) throw new Error(`Missing ${name}`); return v; }

async function main() {
  const userPrivateKey = required('USER_PRIVATE_KEY');
  const contractAddress = required('REGISTRY_CONTRACT_ADDRESS');
  const contractName = process.env.REGISTRY_CONTRACT_NAME || 'operators-registry';

  // Create a network object at runtime and optionally override the base URL
  try {
    const netmod = await import('@stacks/network');
    network = netmod.networkFromName('testnet');
    if (process.env.STACKS_API_URL) network.client.baseUrl = process.env.STACKS_API_URL;
  } catch (e) {
    // fallback: keep network as 'testnet' string
  }

  const operatorId = process.env.OPERATOR_ID || 'operator-001';
  const publicKeyHex = process.env.OPERATOR_PUBLIC_KEY || '0x' + '02'.padEnd(66, '1');
  const endpoint = process.env.OPERATOR_ENDPOINT || 'https://relay.example/v1';

  const userAddress = getAddressFromPrivateKey(userPrivateKey, network);
  const userNonce = await fetchNonce({ address: userAddress, network });

  const tx = await makeContractCall({
    contractAddress,
    contractName,
    functionName: 'register',
    functionArgs: [
      (await import('@stacks/transactions')).stringAsciiCV(operatorId),
      bufferCV(Buffer.from(publicKeyHex.replace(/^0x/, ''), 'hex')),
      (await import('@stacks/transactions')).stringAsciiCV(endpoint),
    ],
    senderKey: userPrivateKey,
    fee: 2000n,
    nonce: userNonce,
    network,
  });

  console.log('Built register tx. Bytes:', tx.serialize().length / 2);
  if (broadcast) {
    const res = await broadcastTransaction({ transaction: tx, network });
    console.log('broadcast result:', res);
  } else {
    console.log('Dry run complete. Add --broadcast to submit.');
  }
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; });
