#!/usr/bin/env tsx
import { config as loadEnv } from 'dotenv';
import { readFileSync, writeFileSync } from 'fs';
import { createECDH } from 'crypto';

loadEnv({ path: '.env.local', quiet: true });

function required(name: string): string { const v = process.env[name]?.trim(); if (!v) throw new Error(`Missing ${name}`); return v; }

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
  const priv = required('OPERATOR_PRIVATE_KEY').replace(/^0x/, '');
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(priv, 'hex'));
  const pub = ecdh.getPublicKey(undefined, 'compressed');
  const hex = '0x' + pub.toString('hex');
  console.log('Derived OPERATOR_PUBLIC_KEY:', hex);
  setEnv('OPERATOR_PUBLIC_KEY', hex);
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; });
