import assert from 'node:assert/strict';
import test from 'node:test';
import { readCachedStacksAccount, requireTestnetStacksAccount } from './stacks-wallet.ts';

test('selects testnet STX from a mixed Leather address response', () => {
  const account = { symbol: 'STX', address: 'STtestnet', publicKey: 'key' };
  assert.deepEqual(requireTestnetStacksAccount({ result: { addresses: [
    { symbol: 'BTC', address: 'tb1bitcoin' },
    { symbol: 'STX', address: 'SPmainnet' },
    account,
  ] } }), account);
});

test('explains a mainnet connection instead of reporting a missing Stacks address', () => {
  assert.throws(() => requireTestnetStacksAccount({ addresses: [
    { symbol: 'STX', address: 'SPmainnet' },
  ] }), /Switch Leather or Xverse to testnet/);
  assert.throws(() => requireTestnetStacksAccount({ addresses: [] }), /Enable Stacks/);
});

test('restores the chosen account from a cache containing older accounts', () => {
  const session = { addresses: { stx: [{ address: 'STolder' }, { address: 'STcurrent' }] } };
  assert.equal(readCachedStacksAccount(session, 'STcurrent')?.address, 'STcurrent');
  assert.equal(readCachedStacksAccount(null), undefined);
  assert.equal(readCachedStacksAccount({ addresses: { stx: [{ address: 'SPmainnet' }] } }), undefined);
});
