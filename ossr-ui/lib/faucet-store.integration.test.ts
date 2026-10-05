import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFaucetStore } from './faucet-store';

if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) throw new Error('Load the faucet Redis environment before running this integration check.');
const namespace = `integration-${randomUUID()}`;
const first = createFaucetStore(namespace, '/unused');
const second = createFaucetStore(namespace, '/unused');
const claim = { at: Date.now(), txid: 'a'.repeat(64), challenge: 'b'.repeat(64) };
try {
  assert.equal(await first.acquire(), true);
  assert.equal(await second.acquire(), false, 'Separate instances must share the sponsor lock');
  await first.save('test-recipient', claim);
  assert.deepEqual(await second.read('test-recipient'), claim, 'Claims must persist across instances');
  await first.release();
  assert.equal(await second.acquire(), true);
  await first.release();
  assert.equal(await createFaucetStore(namespace, '/unused').acquire(), false, 'Old owner cannot release a new lock');
  await second.remove('test-recipient');
  await assert.rejects(first.save('test-recipient', claim), /lock expired/);
  assert.equal(await second.read('test-recipient'), undefined);
  console.log('Redis integration passed: durable receipts, shared lock, ownership checks, cleanup.');
} finally { await first.release(); await second.release(); }
