#!/usr/bin/env tsx
import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  makeContractDeploy,
  broadcastTransaction,
  fetchNonce,
  getAddressFromPrivateKey,
} from '@stacks/transactions';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

const network = 'testnet' as const;

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function main() {
  const privateKey = required('PROTOCOL_PRIVATE_KEY');
  const contractPath = process.env.CONTRACT_PATH || join(process.cwd(), 'contracts', 'reimbursement', 'reimbursement-wrapper.clar');
  const contractName = process.env.CONTRACT_NAME || 'reimbursement-wrapper';

  const codeBody = readFileSync(contractPath, 'utf8');

  const senderAddress = getAddressFromPrivateKey(privateKey, 'testnet');
  const nonce = await fetchNonce({ address: senderAddress, network });

  console.log('Deploying', contractName, 'from', senderAddress);

  const tx = await makeContractDeploy({
    senderKey: privateKey,
    contractName,
    codeBody,
    network,
    fee: 2000n,
    nonce,
  });

  let res = await broadcastTransaction({ transaction: tx, network });
  console.log('broadcast result:', res);
  if (res && typeof res === 'object' && (res as any).error === 'transaction rejected' && (res as any).reason === 'FeeTooLow') {
    const expected = Number((res as any).reason_data?.expected || 0);
    const newFee = BigInt(expected + 200);
    console.log(`Retrying with higher fee: ${newFee} (expected ${expected})`);
    const newNonce = await fetchNonce({ address: senderAddress, network });
    const tx2 = await makeContractDeploy({ senderKey: privateKey, contractName, codeBody, network, fee: newFee, nonce: newNonce });
    res = await broadcastTransaction({ transaction: tx2, network });
    console.log('second broadcast result:', res);
  }
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; });
