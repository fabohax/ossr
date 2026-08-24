#!/usr/bin/env tsx
import { config as loadEnv } from 'dotenv';
import { fetchNonce, makeSTXTokenTransfer, broadcastTransaction } from '@stacks/transactions';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

const network = 'testnet' as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}; set it in .env.local or env`);
  return value;
}

function nonNegativeInteger(name: string, fallback?: string): bigint {
  const value = process.env[name]?.trim() || fallback;
  if (!value || !/^[0-9]+$/.test(value)) throw new Error(`${name} must be a non-negative integer.`);
  return BigInt(value);
}

async function main(): Promise<void> {
  const userPrivateKey = required('USER_PRIVATE_KEY');
  const recipient = required('RECIPIENT_ADDRESS');
  const amount = nonNegativeInteger('TRANSFER_AMOUNT_MICROSTX', '1000000');

  const userAddress = (await import('@stacks/transactions')).getAddressFromPrivateKey(userPrivateKey, 'testnet');
  const userNonce = await fetchNonce({ address: userAddress, network });

  const tx = await makeSTXTokenTransfer({
    recipient,
    amount,
    fee: 1000n,
    nonce: userNonce,
    senderKey: userPrivateKey,
    network,
  });

  const result = await broadcastTransaction({ transaction: tx, network });
  console.log('broadcast result:', result);
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; });
