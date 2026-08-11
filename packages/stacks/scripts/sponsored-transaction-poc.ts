import { config as loadEnv } from 'dotenv';

import {
  broadcastTransaction,
  deserializeTransaction,
  fetchNonce,
  getAddressFromPrivateKey,
  makeSTXTokenTransfer,
  sponsorTransaction,
} from '@stacks/transactions';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

const network = 'testnet' as const;
const broadcast = process.argv.includes('--broadcast');

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}; copy .env.example to .env and set it.`);
  return value;
}

function nonNegativeInteger(name: string, fallback?: string): bigint {
  const value = process.env[name]?.trim() || fallback;
  if (!value || !/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer.`);
  return BigInt(value);
}

function apiUrl(): string {
  return (process.env.STACKS_API_URL || 'https://api.testnet.hiro.so').replace(/\/$/, '');
}

async function waitForConfirmation(txid: string): Promise<void> {
  const timeoutMs = Number(process.env.CONFIRMATION_TIMEOUT_SECONDS || '900') * 1_000;
  const intervalMs = Number(process.env.POLL_INTERVAL_SECONDS || '10') * 1_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(`${apiUrl()}/extended/v1/tx/${txid}`);
    if (response.ok) {
      const transaction = (await response.json()) as { tx_status?: string; block_height?: number };
      console.log(`Chain status: ${transaction.tx_status ?? 'unknown'}`);
      if (transaction.tx_status === 'success') {
        console.log(`Confirmed in block ${transaction.block_height}.`);
        return;
      }
      if (transaction.tx_status?.startsWith('abort_') || transaction.tx_status === 'dropped_replace_by_fee') {
        throw new Error(`Transaction did not succeed: ${transaction.tx_status}`);
      }
    } else if (response.status !== 404) {
      throw new Error(`Could not query transaction status: HTTP ${response.status}`);
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for confirmation after ${timeoutMs / 1_000} seconds; txid: ${txid}`);
}

async function main(): Promise<void> {
  const userPrivateKey = required('USER_PRIVATE_KEY');
  const sponsorPrivateKey = required('SPONSOR_PRIVATE_KEY');
  const recipient = required('RECIPIENT_ADDRESS');
  const amount = nonNegativeInteger('TRANSFER_AMOUNT_MICROSTX', '1');
  const sponsorFee = nonNegativeInteger('SPONSOR_FEE_MICROSTX', '1000');
  if (amount === 0n) throw new Error('TRANSFER_AMOUNT_MICROSTX must be greater than zero.');
  if (sponsorFee === 0n) throw new Error('SPONSOR_FEE_MICROSTX must be greater than zero.');

  const userAddress = getAddressFromPrivateKey(userPrivateKey, network);
  const sponsorAddress = getAddressFromPrivateKey(sponsorPrivateKey, network);
  if (userAddress === sponsorAddress) throw new Error('USER_PRIVATE_KEY and SPONSOR_PRIVATE_KEY must identify different accounts.');
  if (recipient === userAddress || recipient === sponsorAddress) {
    throw new Error('RECIPIENT_ADDRESS must differ from user and sponsor addresses for this PoC.');
  }

  // Fetch both nonces before signing. Do not reuse a sponsor nonce in a relay:
  // production code must serialize this operation around the sponsor wallet.
  const [userNonce, sponsorNonce] = await Promise.all([
    fetchNonce({ address: userAddress, network }),
    fetchNonce({ address: sponsorAddress, network }),
  ]);

  // Step 1 + 2: origin constructs a sponsored transfer and signs only origin auth.
  const originSigned = await makeSTXTokenTransfer({
    recipient,
    amount,
    fee: 0n,
    nonce: userNonce,
    senderKey: userPrivateKey,
    sponsored: true,
    network,
  });
  const originBytes = originSigned.serialize();

  // This deserialize boundary models sending an origin-signed transaction to an
  // independent operator. The operator must validate it before this next step.
  const operatorInput = deserializeTransaction(originBytes);

  // Step 3 + 4: operator supplies its nonce, fee, and sponsor authorization.
  const fullySigned = await sponsorTransaction({
    transaction: operatorInput,
    sponsorPrivateKey,
    sponsorNonce,
    fee: sponsorFee,
    network,
  });

  console.log(JSON.stringify({
    network,
    userAddress,
    sponsorAddress,
    recipient,
    userNonce: userNonce.toString(),
    sponsorNonce: sponsorNonce.toString(),
    amountMicroStx: amount.toString(),
    sponsorFeeMicroStx: sponsorFee.toString(),
    originSignedBytes: originBytes.length / 2,
    fullySignedBytes: fullySigned.serialize().length / 2,
  }, null, 2));

  if (!broadcast) {
    console.log('Dry run passed: origin and sponsor signatures were created. Re-run with --broadcast to submit to Stacks testnet.');
    return;
  }

  // Step 5: only the fully sponsored transaction is broadcast.
  const result = await broadcastTransaction({ transaction: fullySigned, network });
  if (!('txid' in result)) throw new Error(`Broadcast rejected: ${JSON.stringify(result)}`);
  console.log(`Broadcast accepted: ${result.txid}`);
  console.log(`Explorer: https://explorer.hiro.so/txid/${result.txid}?chain=testnet`);

  // Step 6: do not call the PoC successful until the indexed chain status is success.
  await waitForConfirmation(result.txid);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
