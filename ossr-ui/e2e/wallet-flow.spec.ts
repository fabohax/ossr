import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { TransactionSigner, deserializeTransaction } from '@stacks/transactions';
import { OssrRelayApi } from '../../apps/operator/src/api';
import { OssrOperator } from '../../apps/operator/src/operator';
import { prepareWalletContractCall, validateSignedWalletTransaction, type Quote } from '../lib/ossr';
import { origin, sponsor, originKey, sponsorKey, originPublicKey, sbtcContract, adapter } from './fixture-config.mjs';
let chain: Server;
let relay: OssrRelayApi;
test.beforeAll(async () => {
  chain = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ stacks_tip_height: 100 })); });
  chain.listen(0, '127.0.0.1');
  await once(chain, 'listening');
  const address = chain.address();
  if (!address || typeof address === 'string') throw new Error('Fixture chain did not start');
  relay = new OssrRelayApi({
    operator: new OssrOperator({ network: 'testnet', sponsorPrivateKey: sponsorKey, logger: () => undefined }),
    quotePrivateKey: sponsorKey, stacksApiUrl: `http://127.0.0.1:${address.port}`,
    relayId: 'fixture-relay', quoteKeyId: 'fixture-key', policyVersion: 'fixture',
    adapterContractAddress: sponsor, adapterContractName: 'sbtc-sponsored-transfer-v1',
    sbtcContractAddress: sbtcContract.split('.')[0], sbtcContractName: 'sbtc-token', sponsorFeeSats: 1n,
  });
});
test.afterAll(async () => { if (chain) await new Promise<void>((resolve, reject) => chain.close(error => error ? reject(error) : resolve())); });

type Scenario = 'success' | 'rejected' | 'tampered' | 'expired' | 'simulation-stale' | 'balance-offline' | 'paused' | 'credential' | 'zero-balance' | 'broadcast-only';
async function setup(page: Page, scenario: Scenario) {
  let walletCalls = 0;
  let submissions = 0;
  const quote = await relay.quote({ origin, recipient: sponsor, amountSats: '100', maxSponsorFeeSats: '1' });
  await page.exposeFunction('fixtureSign', async (method: string, params: { transaction?: string; broadcast?: boolean }) => {
    if (method !== 'stx_signTransaction') throw new Error(`Unexpected wallet request ${method}`);
    walletCalls++;
    await expect(page.getByText('Verified maximum sBTC outflow: 101 sats.', { exact: false })).toBeVisible();
    await expect(page.getByText('Quote expires in 10 blocks', { exact: false })).toBeVisible();
    expect(params.broadcast).toBe(false);
    if (scenario === 'broadcast-only') return { jsonrpc: '2.0', id: 'fixture', result: { txid: 'ab'.repeat(32) } };
    if (scenario === 'rejected') return { jsonrpc: '2.0', id: 'fixture', error: { code: -32000, message: 'User rejected request' } };
    const transaction = deserializeTransaction(params.transaction!);
    const signer = new TransactionSigner(transaction);
    signer.signOrigin(originKey);
    return { jsonrpc: '2.0', id: 'fixture', result: { transaction: transaction.serialize() } };
  });
  await page.addInitScript(({ origin, publicKey }) => {
    const cache = { addresses: { stx: [{ address: origin, symbol: 'STX' }], btc: [] }, version: '0.0.1' };
    localStorage.setItem('@stacks/connect', Array.from(new TextEncoder().encode(JSON.stringify(cache)), byte => byte.toString(16).padStart(2, '0')).join(''));
    localStorage.setItem('STX_PROVIDER', 'LeatherProvider');
    localStorage.setItem('ossr-ui:connected-stx-address', origin);
    localStorage.setItem('ossr-ui:connected-stx-public-key', publicKey);
    const fixtureWindow = window as unknown as { fixtureSign: (method: string, params: unknown) => Promise<unknown>; LeatherProvider: unknown };
    fixtureWindow.LeatherProvider = { request: (method: string, params: unknown) => fixtureWindow.fixtureSign(method, params) };
  }, { origin, publicKey: originPublicKey });
  await page.route('**/stacks-api/**', route => {
    if (route.request().url().includes('/balances')) {
      if (scenario === 'balance-offline') return route.fulfill({ status: 503, json: { error: 'unavailable' } });
      return route.fulfill({ json: { fungible_tokens: { [`${sbtcContract}::sbtc-token`]: { balance: scenario === 'zero-balance' ? '0' : '10000' } } } });
    }
    if (route.request().url().includes('/nonces')) return route.fulfill({ json: { possible_next_nonce: 0, detected_missing_nonces: [] } });
    if (route.request().url().includes('/accounts/')) return route.fulfill({ json: { nonce: 0 } });
    return route.fulfill({ json: { stacks_tip_height: scenario === 'expired' ? 111 : 100 } });
  });
  await page.route('**/relay/**', async route => {
    const url = route.request().url();
    if (url.endsWith('/v1/info')) return route.fulfill({ json: { apiVersion: '1', relayId: 'fixture-relay', network: 'testnet', sponsorPrincipal: sponsor, adapterContract: adapter, sbtcContract, supportedActions: ['sbtc-transfer'], limits: { sponsorFeeSats: '1', maxNetworkFeeMicroStx: '100000', quoteLifetimeBlocks: '10' }, quotesEnabled: true, sponsorshipsEnabled: scenario !== 'paused' } });
    if (url.endsWith('/v1/quotes')) {
      if (scenario === 'credential' && route.request().headers().authorization !== `Bearer ${'b'.repeat(43)}`) return route.fulfill({ status: 401, json: { error: 'BETA_ACCESS_REQUIRED', message: 'An invited wallet credential is required' } });
      const response = structuredClone(quote);
      if (scenario === 'tampered') response.quote.signature = '00'.repeat(65);
      return route.fulfill({ status: 201, json: response });
    }
    if (url.endsWith('/v1/sponsorships')) {
      submissions++;
      const input = route.request().postDataJSON();
      expect(input.quoteId).toBe(quote.quote.quoteId);
      expect(input.user).toBe(origin);
      validateSignedWalletTransaction(input.transaction, prepareWalletContractCall({ quote: quote.quote as Quote, recipient: sponsor, amountSats: '100' }), origin);
      if (scenario === 'simulation-stale') return route.fulfill({ status: 503, json: { error: 'SIMULATION_STALE', message: 'Simulation node is stale' } });
      return route.fulfill({ status: 201, json: { status: 'BROADCAST', transaction_id: 'ab'.repeat(32), fee_microstx: '600' } });
    }
    return route.fulfill({ json: { transactionId: `0x${'ab'.repeat(32)}`, status: 'success', blockHeight: 105 } });
  });
  return { observations: () => ({ walletCalls, submissions }) };
}
for (const scenario of ['success', 'rejected', 'tampered', 'expired', 'simulation-stale', 'balance-offline', 'paused', 'credential', 'zero-balance', 'broadcast-only'] as const) {
  test(`mock wallet flow: ${scenario}`, async ({ page }, testInfo) => {
    const fixture = await setup(page, scenario);
    await page.goto('/dashboard');
    await expect(page.getByText('MOCKED DEMO', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change wallet', exact: true })).toBeVisible();
    await expect(page.getByText('Relay online', { exact: true })).toBeVisible();
    if (scenario !== 'balance-offline' && scenario !== 'zero-balance') await expect(page.getByText('10000 sats', { exact: true }).first()).toBeVisible();
    await page.getByRole('combobox', { name: 'To', exact: true }).fill(sponsor);
    await page.getByLabel('Amount', { exact: true }).fill('100');
    if (scenario === 'balance-offline' || scenario === 'paused' || scenario === 'zero-balance') {
      if (scenario === 'balance-offline') await expect(page.getByText('Unavailable', { exact: true }).first()).toBeVisible();
      if (scenario === 'paused') await expect(page.getByText('The operator paused new sponsorships.', { exact: false })).toBeVisible();
      if (scenario === 'zero-balance') await expect(page.getByText('Insufficient sBTC balance', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign in wallet' })).toBeDisabled();
      expect(fixture.observations()).toEqual({ walletCalls: 0, submissions: 0 });
      return;
    }
    await page.getByRole('button', { name: 'Sign in wallet' }).click();
    if (scenario === 'credential') {
      await expect(page.getByText('Beta access required', { exact: true })).toBeVisible();
      expect(fixture.observations()).toEqual({ walletCalls: 0, submissions: 0 });
      await page.getByRole('tab', { name: 'Advanced' }).click();
      await page.getByLabel('Invited beta access credential (optional)', { exact: true }).fill('b'.repeat(43));
      await page.getByRole('tab', { name: 'Transfer', exact: true }).click();
      await page.getByRole('button', { name: 'Sign in wallet' }).click();
    }
    if (scenario === 'success' || scenario === 'credential') {
      await expect(page.getByText('Transaction successful', { exact: true })).toBeVisible();
      await expect(page.locator('a[href*="chain=testnet"]').first()).toBeVisible();
      expect(fixture.observations()).toEqual({ walletCalls: 1, submissions: 1 });
    } else {
      await expect(page.getByText(scenario === 'simulation-stale' ? 'Simulation is stale' : "We couldn't complete that request", { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign in wallet' })).toBeEnabled();
      expect(fixture.observations()).toEqual({ walletCalls: scenario === 'tampered' || scenario === 'expired' ? 0 : 1, submissions: scenario === 'simulation-stale' ? 1 : 0 });
      await expect(page.getByText('Transaction successful', { exact: true })).toHaveCount(0);
    }
    await page.evaluate(async () => { await Promise.race([Promise.all(document.getAnimations().filter(animation => animation.playState === 'running' && Number.isFinite(Number(animation.effect?.getComputedTiming().iterations))).map(animation => animation.finished.catch(() => undefined))), new Promise(resolve => setTimeout(resolve, 1000))]); });
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`mock-${scenario}.png`), fullPage: true });
  });
}
