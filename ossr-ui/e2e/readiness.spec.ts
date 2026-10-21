import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const txid = `0x${'ab'.repeat(32)}`;
const origin = 'ST14MZ2VA0731Q6TEPK82FDQNHWKY8NPEMND33NE4';
const recipient = 'ST2QKEV89ZB3PCW1KC8206FDFJ7F6QANMR22ZG7F5';
const saved = {
  response: { status: 'BROADCAST', transaction_id: txid },
  intent: { relayUrl: '/relay', origin, recipient, amountSats: '100', maxSponsorFeeSats: '10' },
  quote: { quote: { sponsorFee: '10', sponsorPrincipal: recipient, expiresAtBlock: '110' } },
};
test('disconnected and relay-offline states remain accessible and do not submit', async ({ page }) => {
  let writes = 0;
  await page.route('**/relay/**', route => {
    if (route.request().method() === 'POST') writes++;
    return route.fulfill({ status: 503, json: { error: 'offline' } });
  });
  const response = await page.goto('/dashboard');
  expect(response?.headers()['x-content-type-options']).toBe('nosniff');
  expect(response?.headers()['x-frame-options']).toBe('DENY');
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  expect(response?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  await expect(page.getByText('Relay offline', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible();
  await expect(page.getByText('Testnet prototype only.', { exact: false })).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(async () => { await Promise.race([Promise.all(document.getAnimations().filter(animation => animation.playState === 'running' && Number.isFinite(Number(animation.effect?.getComputedTiming().iterations))).map(animation => animation.finished.catch(() => undefined))), new Promise(resolve => setTimeout(resolve, 1000))]); });
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
  expect(writes).toBe(0);
});
for (const status of ['pending', 'success', 'abort_by_response', 'abort_by_post_condition', 'dropped_replace_by_fee', 'not_found']) {
  test(`restores ${status} receipt without creating another payment`, async ({ page }) => {
    let writes = 0;
    await page.addInitScript(receipt => localStorage.setItem('ossr-ui:submitted-transfer', JSON.stringify(receipt)), saved);
    await page.route('**/relay/**', route => {
      if (route.request().method() === 'POST') writes++;
      if (route.request().url().includes('/sponsorships/')) return route.fulfill({ json: { transactionId: txid, status, blockHeight: status === 'success' ? 105 : undefined } });
      return route.fulfill({ status: 503, json: { error: 'offline' } });
    });
    await page.goto('/dashboard');
    await expect(page.getByRole('link').filter({ hasText: '0xabab' }).first()).toBeVisible();
    await expect(page.locator(`a[href*="${txid}"]`).first()).toHaveAttribute('href', /chain=testnet/);
    await page.reload();
    await expect(page.getByRole('button', { name: 'View submitted transfer' })).toBeVisible();
    await page.getByRole('button', { name: 'View submitted transfer' }).click();
    if (status === 'success') {
      await expect(page.getByText('Transaction successful', { exact: true })).toBeVisible();
      await expect(page.getByText('Confirmed successfully', { exact: true })).toBeVisible();
    } else if (status.startsWith('dropped_')) await expect(page.getByText('Rechecking chain status', { exact: true })).toBeVisible();
    else if (status.startsWith('abort_')) await expect(page.getByText('Transaction failed', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(writes).toBe(0);
  });
}

// The fixture build must refuse the actual server-side faucet even if developer
// environment keys are present. No mock intercepts this request.
test('fixture mode cannot send real faucet funds', async ({ request }) => {
  const response = await request.post('/api/testnet-sbtc', { data: { address: origin } });
  expect(response.status()).toBe(503);
  expect((await response.json()).error).toContain('Faucet disabled in fixture mode');
});

test('broadcast receipt transitions to pending and confirmation without resubmission', async ({ page }) => {
  let phase = 'pending';
  let writes = 0;
  let release!: () => void;
  const firstResponse = new Promise<void>(resolve => { release = resolve; });
  await page.addInitScript(receipt => localStorage.setItem('ossr-ui:submitted-transfer', JSON.stringify(receipt)), saved);
  await page.route('**/relay/**', async route => {
    if (route.request().method() === 'POST') writes++;
    if (route.request().url().includes('/sponsorships/')) {
      await firstResponse;
      return route.fulfill({ json: { transactionId: txid, status: phase, blockHeight: phase === 'success' ? 105 : undefined } });
    }
    return route.fulfill({ status: 503, json: { error: 'offline' } });
  });
  try {
    await page.goto('/dashboard');
    await expect(page.getByText('Submitted transfer: 100 sats · Broadcast', { exact: true })).toBeVisible();
    release();
    await expect(page.getByText('Submitted transfer: 100 sats · pending', { exact: true })).toBeVisible();
    phase = 'success';
    await expect(page.getByText('Submitted transfer: 100 sats · success', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'View submitted transfer' }).click();
    await expect(page.getByText('Transaction successful', { exact: true })).toBeVisible();
    await expect(page.locator(`a[href*="${txid}"]`).first()).toHaveAttribute('href', /chain=testnet/);
    expect(writes).toBe(0);
  } finally { release(); }
});
