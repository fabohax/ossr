#!/usr/bin/env tsx
import fetch from 'node-fetch';

const txid = process.argv[2] || process.env.TXID;
if (!txid) {
  console.error('Usage: node wait-tx.ts <txid>');
  process.exit(1);
}

const api = process.env.STACKS_API_URL || 'https://api.testnet.hiro.so';

async function main() {
  const deadline = Date.now() + 120_000; // 2 minutes
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${api.replace(/\/$/, '')}/extended/v1/tx/${txid}`);
      if (res.status === 200) {
        const j = await res.json();
        console.log('status:', j.tx_status);
        if (j.tx_status === 'success') return 0;
        if (j.tx_status && j.tx_status.startsWith('abort_')) throw new Error('tx failed: ' + j.tx_status);
      } else if (res.status === 404) {
        console.log('status: not_found');
      } else {
        console.log('status: http', res.status);
      }
    } catch (err) {
      console.error('poll error', err instanceof Error ? err.message : err);
    }
    await new Promise(r => setTimeout(r, 4000));
  }
  throw new Error('timed out waiting for tx confirmation');
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(2); });
