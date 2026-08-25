import { config as loadEnv } from 'dotenv';
import {
  bufferCV,
  fetchNonce,
  getAddressFromPrivateKey,
  makeContractCall,
  noneCV,
  Pc,
  PostConditionMode,
  someCV,
  standardPrincipalCV,
  uintCV,
} from '@stacks/transactions';
import type { ContractIdString } from '@stacks/transactions';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

const network = 'testnet' as const;

type QuoteResponse = {
  quote: {
    quoteId: string;
    origin: string;
    recipient?: string;
    adapterContract: string;
    functionName: 'sponsored-transfer';
    reimbursementAsset: { contract: string };
    sponsorFee: string;
    expiresAtBlock: string;
  };
  quotePublicKey: string;
};

type SponsorResult = {
  status: 'BROADCAST';
  operator: string;
  transaction_id: string;
  transactionId?: string;
  fee_microstx: string;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}; set it in .env.local or .env.`);
  return value;
}

function positiveInteger(name: string, fallback: string): bigint {
  const value = process.env[name]?.trim() || fallback;
  if (!/^\d+$/.test(value) || value === '0') throw new Error(`${name} must be a positive integer.`);
  return BigInt(value);
}

async function main(): Promise<void> {
  const userPrivateKey = required('USER_PRIVATE_KEY');
  const recipient = required('RECIPIENT_ADDRESS');
  const amountSats = positiveInteger('SBTC_TRANSFER_AMOUNT_SATS', '100');
  const maxSponsorFeeSats = positiveInteger('SBTC_MAX_SPONSOR_FEE_SATS', process.env.SBTC_SPONSOR_FEE_SATS ?? '10');
  const apiUrl = (process.env.OSSR_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
  const stacksApiUrl = (process.env.STACKS_API_URL ?? 'https://api.testnet.hiro.so').replace(/\/$/, '');
  const user = getAddressFromPrivateKey(userPrivateKey, network);
  if (recipient === user) throw new Error('RECIPIENT_ADDRESS must differ from the user address.');

  const memo = process.env.SBTC_MEMO_HEX ? `0x${process.env.SBTC_MEMO_HEX.replace(/^0x/, '')}` : undefined;
  const quoteResponse = await fetchJson<QuoteResponse>(`${apiUrl}/v1/quotes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      origin: user,
      recipient,
      amountSats: amountSats.toString(),
      maxSponsorFeeSats: maxSponsorFeeSats.toString(),
      ...(memo ? { memo } : {}),
    }),
  });
  const quote = quoteResponse.quote;
  if (quote.origin !== user) throw new Error('Relay returned a quote for a different origin.');
  const [contractAddress, contractName] = splitContractPrincipal(quote.adapterContract);
  const totalSats = amountSats + BigInt(quote.sponsorFee);

  const transaction = await makeContractCall({
    contractAddress,
    contractName,
    functionName: quote.functionName,
    functionArgs: [
      uintCV(amountSats),
      standardPrincipalCV(recipient),
      uintCV(BigInt(quote.sponsorFee)),
      bufferCV(hexToBytes(quote.quoteId)),
      uintCV(BigInt(quote.expiresAtBlock)),
      memo === undefined ? noneCV() : someCV(bufferCV(hexToBytes(memo))),
    ],
    senderKey: userPrivateKey,
    nonce: await fetchNonce({ address: user, network, client: { baseUrl: stacksApiUrl } }),
    fee: 0n,
    sponsored: true,
    network,
    postConditionMode: PostConditionMode.Deny,
    postConditions: [Pc.principal(user).willSendEq(totalSats).ft(asContractId(quote.reimbursementAsset.contract), 'sbtc-token')],
  });

  const submittedAtMs = Date.now();
  const response = await fetchJson<SponsorResult>(`${apiUrl}/v1/sponsorships`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ quoteId: quote.quoteId, transaction: `0x${transaction.serialize()}`, user }),
  });

  console.log(JSON.stringify({
    event: 'client.submitted',
    user,
    recipient,
    amountSats: amountSats.toString(),
    sponsorFeeSats: quote.sponsorFee,
    quoteId: quote.quoteId,
    quotePublicKey: quoteResponse.quotePublicKey,
    ...response,
  }, null, 2));

  if (!process.argv.includes('--wait')) return;
  const txid = response.transactionId ?? `0x${response.transaction_id}`;
  const confirmed = await waitForConfirmation(txid, apiUrl);
  console.log(JSON.stringify({
    event: 'client.confirmed',
    transactionId: txid,
    confirmedAt: new Date().toISOString(),
    confirmationTimeSeconds: (Date.now() - submittedAtMs) / 1_000,
    ...confirmed,
  }, null, 2));
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body as T;
}

async function waitForConfirmation(txid: string, apiUrl: string): Promise<{ status: string; blockHeight?: number }> {
  const deadline = Date.now() + Number(process.env.CONFIRMATION_TIMEOUT_SECONDS ?? '900') * 1_000;
  while (Date.now() < deadline) {
    const status = await fetchJson<{ status: string; blockHeight?: number }>(`${apiUrl}/v1/sponsorships/${txid}`);
    if (status.status === 'success') return status;
    if (status.status.startsWith('abort_') || status.status === 'dropped_replace_by_fee') throw new Error(`Transaction failed: ${status.status}`);
    await new Promise(resolve => setTimeout(resolve, Number(process.env.POLL_INTERVAL_SECONDS ?? '10') * 1_000));
  }
  throw new Error(`Timed out waiting for confirmation: ${txid}`);
}

function splitContractPrincipal(principal: string): [string, string] {
  const index = principal.lastIndexOf('.');
  if (index < 1 || index === principal.length - 1) throw new Error(`Invalid contract principal: ${principal}`);
  return [principal.slice(0, index), principal.slice(index + 1)];
}

function asContractId(principal: string): ContractIdString {
  splitContractPrincipal(principal);
  return principal as ContractIdString;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^0x(?:[0-9a-f]{2})*$/i.test(hex)) throw new Error(`Invalid hex string: ${hex}`);
  return Uint8Array.from(Buffer.from(hex.slice(2), 'hex'));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
