#!/usr/bin/env tsx
import { config as loadEnv } from 'dotenv';
import { randomBytes } from 'node:crypto';
import {
  bufferCV,
  fetchNonce,
  getAddressFromPrivateKey,
  makeContractCall,
  noneCV,
  PostConditionMode,
  someCV,
  standardPrincipalCV,
  uintCV,
  Pc,
} from '@stacks/transactions';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

const network = 'testnet' as const;
const sbtcContract = 'SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function positive(name: string, fallback: string): bigint {
  const value = process.env[name]?.trim() || fallback;
  if (!/^\d+$/.test(value) || value === '0') throw new Error(`${name} must be a positive integer.`);
  return BigInt(value);
}

async function main(): Promise<void> {
  const senderKey = required('USER_PRIVATE_KEY');
  const sender = getAddressFromPrivateKey(senderKey, network);
  const recipient = required('RECIPIENT_ADDRESS');
  const contractAddress = required('ADAPTER_CONTRACT_ADDRESS');
  const contractName = process.env.ADAPTER_CONTRACT_NAME?.trim() || 'sbtc-sponsored-transfer-v1';
  const amount = positive('SBTC_TRANSFER_AMOUNT_SATS', '100');
  const sponsorFee = positive('SBTC_SPONSOR_FEE_SATS', '10');
  const total = amount + sponsorFee;
  const apiUrl = (process.env.OSSR_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
  const stacksApiUrl = (process.env.STACKS_API_URL ?? 'https://api.testnet.hiro.so').replace(/\/$/, '');
  const info = await (await fetch(`${stacksApiUrl}/v2/info`)).json() as { stacks_tip_height?: number };
  if (!Number.isSafeInteger(info.stacks_tip_height)) throw new Error('Could not determine the current Stacks height.');
  const expiry = BigInt(info.stacks_tip_height + Number(process.env.QUOTE_TTL_BLOCKS ?? '10'));
  const quoteId = randomBytes(32);
  const memoHex = process.env.SBTC_MEMO_HEX?.trim();
  if (memoHex && (!/^(?:[0-9a-fA-F]{2}){0,34}$/.test(memoHex))) throw new Error('SBTC_MEMO_HEX must contain at most 34 bytes of hexadecimal data.');

  const transaction = await makeContractCall({
    contractAddress,
    contractName,
    functionName: 'sponsored-transfer',
    functionArgs: [
      uintCV(amount), standardPrincipalCV(recipient), uintCV(sponsorFee), bufferCV(quoteId), uintCV(expiry),
      memoHex === undefined ? noneCV() : someCV(bufferCV(Buffer.from(memoHex, 'hex'))),
    ],
    senderKey,
    nonce: await fetchNonce({ address: sender, network, client: { baseUrl: stacksApiUrl } }),
    fee: 0n,
    sponsored: true,
    network,
    postConditionMode: PostConditionMode.Deny,
    postConditions: [Pc.principal(sender).willSendEq(total).ft(sbtcContract, 'sbtc-token')],
  });
  const request = { transaction: `0x${transaction.serialize()}`, user: sender };
  if (!process.argv.includes('--submit')) {
    console.log(JSON.stringify({ network, sender, recipient, adapter: `${contractAddress}.${contractName}`, amountSats: amount.toString(), sponsorFeeSats: sponsorFee.toString(), totalSats: total.toString(), expiryHeight: expiry.toString(), quoteId: quoteId.toString('hex'), postCondition: 'deny; origin sends exactly total sBTC', request }, null, 2));
    return;
  }
  const response = await fetch(`${apiUrl}/v1/sponsor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  const body = await response.json();
  if (!response.ok) throw new Error(`Relay rejected atomic transfer (${response.status}): ${JSON.stringify(body)}`);
  console.log(JSON.stringify(body, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
