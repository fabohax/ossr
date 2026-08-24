#!/usr/bin/env tsx
import { randomBytes } from 'node:crypto';
import { getAddressFromPrivateKey } from '@stacks/transactions';

function toHex(b: Buffer) { return b.toString('hex'); }

function generatePrivateKeyHex() {
  // generate 32 bytes -> 64 hex chars
  return toHex(randomBytes(32));
}

function main() {
  const pk = generatePrivateKeyHex();
  const address = getAddressFromPrivateKey(pk, 'testnet');
  console.log('PRIVATE_KEY=' + pk);
  console.log('ADDRESS=' + address);
}

main();
