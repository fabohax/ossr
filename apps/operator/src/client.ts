import { config as loadEnv } from 'dotenv';
import { fetchNonce, getAddressFromPrivateKey, makeSTXTokenTransfer } from '@stacks/transactions';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

const network = 'testnet' as const;

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

type SponsorResult = { status: 'accepted'; operator: string; transaction_id: string; fee_microstx: string };

async function main(): Promise<void> {
  const userPrivateKey = required('USER_PRIVATE_KEY');
  const recipient = required('RECIPIENT_ADDRESS');
  const amount = positiveInteger('TRANSFER_AMOUNT_MICROSTX', '1');
  const apiUrl = (process.env.OSSR_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
  const stacksApiUrl = (process.env.STACKS_API_URL ?? 'https://api.testnet.hiro.so').replace(/\/$/, '');
  const user = getAddressFromPrivateKey(userPrivateKey, network);
  if (recipient === user) throw new Error('RECIPIENT_ADDRESS must differ from the user address.');

  const transaction = await makeSTXTokenTransfer({
    recipient, amount, fee: 0n,
    nonce: await fetchNonce({ address: user, network, client: { baseUrl: stacksApiUrl } }),
    senderKey: userPrivateKey, sponsored: true, network,
  });
  const submittedAtMs = Date.now();
  const submittedAt = new Date(submittedAtMs).toISOString();
  const response = await fetch(`${apiUrl}/v1/sponsor`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ transaction: `0x${transaction.serialize()}`, user }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isSponsorResult(body)) throw new Error(`Relay rejected request (${response.status}): ${JSON.stringify(body)}`);

  console.log(JSON.stringify({ event: 'client.submitted', submittedAt, user, recipient, amountMicroStx: amount.toString(), ...body }, null, 2));
  if (!process.argv.includes('--wait')) return;
  const confirmed = await waitForConfirmation(body.transaction_id, stacksApiUrl);
  console.log(JSON.stringify({ event: 'client.confirmed', transaction_id: body.transaction_id, confirmedAt: new Date().toISOString(), confirmationTimeSeconds: (Date.now() - submittedAtMs) / 1_000, ...confirmed }, null, 2));
}

async function waitForConfirmation(txid: string, stacksApiUrl: string): Promise<{ status: string; blockHeight?: number }> {
  const deadline = Date.now() + Number(process.env.CONFIRMATION_TIMEOUT_SECONDS ?? '900') * 1_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${stacksApiUrl}/extended/v1/tx/${txid}`);
    if (response.ok) {
      const tx = await response.json() as { tx_status?: string; block_height?: number };
      if (tx.tx_status === 'success') return { status: tx.tx_status, blockHeight: tx.block_height };
      if (tx.tx_status?.startsWith('abort_') || tx.tx_status === 'dropped_replace_by_fee') throw new Error(`Transaction failed: ${tx.tx_status}`);
    } else if (response.status !== 404) throw new Error(`Could not query transaction status: HTTP ${response.status}`);
    await new Promise(resolve => setTimeout(resolve, Number(process.env.POLL_INTERVAL_SECONDS ?? '10') * 1_000));
  }
  throw new Error(`Timed out waiting for confirmation: ${txid}`);
}

function isSponsorResult(value: unknown): value is SponsorResult {
  return typeof value === 'object' && value !== null &&
    (value as Record<string, unknown>).status === 'accepted' &&
    typeof (value as Record<string, unknown>).operator === 'string' &&
    typeof (value as Record<string, unknown>).transaction_id === 'string' &&
    typeof (value as Record<string, unknown>).fee_microstx === 'string';
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
