#!/usr/bin/env tsx
import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  makeContractDeploy,
  broadcastTransaction,
  fetchNonce,
  getAddressFromPrivateKey,
  AnchorMode,
} from '@stacks/transactions';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

const network = 'testnet' as const;

function required(name: string): string {
  const v = process.env[name]?.trim(); if (!v) throw new Error(`Missing ${name}`); return v;
}

async function pollTx(txid: string, attempts = 12, delayMs = 5000) {
  const urls = [
    `https://api.testnet.hiro.so/extended/v1/tx/${txid}`,
    `https://stacks-node-api.testnet.stacks.co/extended/v1/tx/${txid}`,
  ];
  for (let i = 0; i < attempts; i++) {
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.text();
          console.log('Found tx on', url);
          console.log(json);
          return true;
        }
      } catch (e) {
        // ignore
      }
    }
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

async function main() {
  const privateKey = required('PROTOCOL_PRIVATE_KEY');
  const contractPath = process.env.CONTRACT_PATH || join(process.cwd(), 'contracts', 'registry', 'operators-registry.clar');
  const contractName = process.env.CONTRACT_NAME || 'operators-registry';

  const codeBody = readFileSync(contractPath, 'utf8');

  const senderAddress = getAddressFromPrivateKey(privateKey, 'testnet');
  const nonce = await fetchNonce({ address: senderAddress, network });

  console.log('Deploying', contractName, 'from', senderAddress);

  // Use a generous fee to avoid FeeTooLow rejections (2 STX)
  const fee = 2000000n;

  const tx = await makeContractDeploy({ senderKey: privateKey, contractName, codeBody, network, fee, nonce, anchorMode: AnchorMode.Any });
  const res = await broadcastTransaction({ transaction: tx, network });
  console.log('broadcast result:', res);
  const txid = (res && typeof res === 'object' && (res as any).txid) ? (res as any).txid : undefined;
  if (!txid) {
    console.error('No txid returned from broadcast; aborting.');
    process.exit(1);
  }

  console.log('Polling for transaction inclusion:', txid);
  const ok = await pollTx(txid);
  if (!ok) {
    console.warn('Transaction not found by public APIs within timeout. It may still be pending.');
    process.exitCode = 1;
  } else {
    console.log('Deploy seems indexed. You can now call the contract.');
  }
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; });
