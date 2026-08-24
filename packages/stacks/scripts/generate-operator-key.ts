#!/usr/bin/env tsx
import { config as loadEnv } from 'dotenv';
import { randomBytes } from 'crypto';
import { bytesToHex } from '@stacks/common';
import { privateKeyToString, createStacksPrivateKey, getAddressFromPrivateKey } from '@stacks/transactions';
import { writeFileSync, readFileSync } from 'fs';

loadEnv({ path: '.env.local', silent: true });

function setEnv(key: string, value: string) {
  const path = '.env.local';
  let content = '';
  try { content = readFileSync(path, 'utf8'); } catch { content = ''; }
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) content = content.replace(re, `${key}=${value}`);
  else content = content + `\n${key}=${value}\n`;
  writeFileSync(path, content, 'utf8');
}

async function main() {
  // Create a random 32-byte private key and convert to Stacks-format
  const raw = randomBytes(32);
  const hex = bytesToHex(raw);
  const pk = `0x${hex}`;
  const address = getAddressFromPrivateKey(pk, 'testnet');
  console.log('Generated operator address:', address);
  setEnv('OPERATOR_PRIVATE_KEY', pk);
  setEnv('OPERATOR_ADDRESS', address);
  setEnv('OPERATOR', address);
  console.log('Wrote OPERATOR_PRIVATE_KEY and OPERATOR_ADDRESS to .env.local');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
