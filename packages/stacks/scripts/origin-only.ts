import { config as loadEnv } from 'dotenv';
import { fetchNonce, getAddressFromPrivateKey, makeSTXTokenTransfer } from '@stacks/transactions';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

const network = 'testnet' as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}; copy .env.example to .env and set it.`);
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
  const amount = nonNegativeInteger('TRANSFER_AMOUNT_MICROSTX', '1');
  const userAddress = getAddressFromPrivateKey(userPrivateKey, network);
  const userNonce = await fetchNonce({ address: userAddress, network });

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
  console.log(JSON.stringify({ originHex: `0x${originBytes}`, user: userAddress }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
