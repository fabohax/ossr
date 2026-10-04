import assert from 'node:assert/strict';
import test from 'node:test';
import { requestTestnetWalletAccounts, walletConnectionRequest, withWalletTimeout } from './connect-wallet';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });

test('Xverse receives its native connection method and Testnet network without legacy detection', async () => {
  const calls: unknown[] = [];
  const provider = { request: async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    assert.equal(method, 'wallet_connect');
    assert.equal(params.network, 'Testnet');
    assert.deepEqual(params.addresses, ['stacks']);
    return { jsonrpc: '2.0', id: '1', result: { addresses: [{ address: 'STtestnet', publicKey: 'key', purpose: 'stacks' }] } };
  } };
  const result = await requestTestnetWalletAccounts('XverseProviders.BitcoinProvider', provider);
  assert.equal(result.addresses[0].address, 'STtestnet');
  assert.equal(calls.length, 1);
});

test('Leather uses stx_getAddresses with lowercase testnet', () => {
  assert.deepEqual(walletConnectionRequest('LeatherProvider'), { method: 'stx_getAddresses', params: { network: 'testnet' } });
});

test('unresponsive wallet rejects so the UI can clear Connecting', async () => {
  await assert.rejects(withWalletTimeout(new Promise(() => {}), 5), /wallet did not respond/);
});

test('wallet rejection propagates and mainnet accounts cannot connect', async () => {
  await assert.rejects(requestTestnetWalletAccounts('XverseProviders.BitcoinProvider', { request: async () => ({ error: { code: -32000, message: 'User rejected request' } }) }), /User rejected/);
  await assert.rejects(requestTestnetWalletAccounts('XverseProviders.BitcoinProvider', { request: async () => ({ result: { addresses: [{ address: 'SPmainnet', purpose: 'stacks' }] } }) }), /Switch Leather or Xverse to testnet/);
});
