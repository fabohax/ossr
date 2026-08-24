#!/usr/bin/env tsx
import { config as loadEnv } from 'dotenv';
import {
  makeContractCall,
  deserializeTransaction,
} from '@stacks/transactions';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

const network = 'testnet' as const;

function required(name: string): string { const v = process.env[name]?.trim(); if (!v) throw new Error(`Missing ${name}`); return v; }

async function main() {
  const userPrivateKey = required('USER_PRIVATE_KEY');
  const contractAddress = required('REGISTRY_CONTRACT_ADDRESS');
  const contractName = process.env.REGISTRY_CONTRACT_NAME || 'operators-registry';

  const operatorId = process.env.OPERATOR_ID || 'operator-001';
  const publicKeyHex = process.env.OPERATOR_PUBLIC_KEY || '02'.padEnd(66, '1');
  const endpoint = process.env.OPERATOR_ENDPOINT || 'https://relay.example/v1';

  const tx = await makeContractCall({
    contractAddress,
    contractName,
    functionName: 'register',
    functionArgs: [
      (await import('@stacks/transactions')).stringAsciiCV(operatorId),
      (await import('@stacks/transactions')).bufferCV(Buffer.from(publicKeyHex.replace(/^0x/, ''), 'hex')),
      (await import('@stacks/transactions')).stringAsciiCV(endpoint),
    ],
    senderKey: userPrivateKey,
    fee: 2000n,
    network,
  });

  const hex = tx.serialize();
  console.log('Serialized tx hex length (bytes):', hex.length/2);
  console.log('Serialized tx hex (hex):', hex);
  console.log('Contract Address used:', contractAddress);
  console.log('Contract Name used:', contractName);
  try {
    const des = deserializeTransaction(hex);
    console.log('Deserialized transaction:');
    const replacer = (_k: string, v: any) => (typeof v === 'bigint' ? v.toString() : v);
    console.log(JSON.stringify(des, replacer, 2));
  } catch (err) {
    console.error('Failed to deserialize transaction:', err);
  }
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; });
