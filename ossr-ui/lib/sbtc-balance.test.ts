import assert from 'node:assert/strict';
import test from 'node:test';
import { cachedSbtcBalance, defaultSbtcContract, fetchDisplaySbtcBalance } from './sbtc-balance';
import { fetchSbtcBalance } from './ossr';

test('balance display shares requests, reuses fresh results, and keeps signing checks fresh', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = originalNow();
  let calls = 0;
  let fail = false;
  let release: (() => void) | undefined;
  Date.now = () => now;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) await new Promise<void>(resolve => { release = resolve; });
    if (fail) throw new TypeError('Network unavailable');
    return Response.json({ fungible_tokens: { [`${defaultSbtcContract}::sbtc-token`]: { balance: String(calls * 10) } } });
  };
  try {
    const first = fetchDisplaySbtcBalance('STbalance-test');
    const duplicate = fetchDisplaySbtcBalance('STbalance-test');
    assert.equal(first, duplicate);
    assert.equal(calls, 1);
    release!();
    assert.equal((await first).balanceSats, '10');
    assert.equal((await fetchDisplaySbtcBalance('STbalance-test')).balanceSats, '10');
    assert.equal(calls, 1);
    assert.equal((await fetchSbtcBalance('STbalance-test')).balanceSats, '20');
    assert.equal(calls, 2, 'Signing checks must bypass the display cache');
    assert.equal(cachedSbtcBalance('STdifferent-account'), undefined);
    assert.equal(cachedSbtcBalance('STbalance-test', 'STother.token'), undefined);
    now += 20_000;
    fail = true;
    await assert.rejects(fetchDisplaySbtcBalance('STbalance-test'));
    assert.equal(cachedSbtcBalance('STbalance-test')?.balanceSats, '10', 'Keep last balance when refresh fails');
    fail = false;
    assert.equal((await fetchDisplaySbtcBalance('STbalance-test')).balanceSats, '40', 'Failed request must be retryable');
    now += 5 * 60_000;
    assert.equal(cachedSbtcBalance('STbalance-test'), undefined);
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
});

test('browser balance and chain requests use the same-origin proxy', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const urls: string[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  globalThis.fetch = async input => {
    const url = String(input);
    urls.push(url);
    return Response.json(url.endsWith('/v2/info') ? { stacks_tip_height: 123 } : { fungible_tokens: {} });
  };
  try {
    const { fetchStacksTipHeight } = await import('./ossr');
    assert.equal((await fetchSbtcBalance('STcors-test')).balanceSats, '0');
    assert.equal(await fetchStacksTipHeight(), 123);
    assert.deepEqual(urls, ['/stacks-api/extended/v1/address/STcors-test/balances', '/stacks-api/v2/info']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
