import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAddressFromPrivateKey } from '@stacks/transactions';
import { JsonOperatorRegistryStore, OperatorRegistry, toEntry } from './registry.js';

const registryPath = join(await mkdtemp(join(tmpdir(), 'ossr-registry-')), 'operators.json');
const registry = new OperatorRegistry(new JsonOperatorRegistryStore(registryPath), () => new Date('2026-08-14T12:00:00.000Z'));
const address = getAddressFromPrivateKey('1'.repeat(64), 'testnet');

const registered = await registry.register({
  operatorId: 'operator-001',
  publicKey: `0x${'02'.padEnd(66, '1')}`,
  endpoint: 'https://relay.example/v1',
  status: 'OFFLINE',
  stxBalanceMicroStx: 42_800_000n,
  sbtcBalanceSats: 210_000n,
  feeBps: 10,
  supportedTransactionTypes: ['stx_transfer'],
  reimbursementAddress: address,
});
assert.equal(registered.lastSeen, '2026-08-14T12:00:00.000Z');
assert.equal(toEntry(registered).stx_balance_microstx, '42800000');
assert.equal((await registry.list({ status: 'ONLINE' })).length, 0);

const online = await registry.heartbeat('operator-001');
assert.equal(online.status, 'ONLINE');
assert.equal((await registry.list({ status: 'ONLINE' })).length, 1);
assert.equal(JSON.parse(await readFile(registryPath, 'utf8'))[0].fee_bps, 10);
assert.rejects(() => registry.register({ ...registered }), /already registered/);
assert.rejects(() => registry.update('operator-001', { supportedTransactionTypes: [] }), /supported_transaction_types/);
