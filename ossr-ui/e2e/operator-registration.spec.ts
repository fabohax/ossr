import { expect, test } from '@playwright/test';
import { bufferCV, serializeCV, stringAsciiCV } from '@stacks/transactions';
import { origin, originPublicKey } from './fixture-config.mjs';

const operatorId = 'smoke-operator-lima';
const relayEndpoint = 'https://relay.example.test/v1';
const txid = 'ab'.repeat(32);
const quotePublicKey = originPublicKey;

test('operator registration submits the new record through the wallet interface', async ({ page }) => {
  let walletCall: { method: string; params: Record<string, unknown> } | undefined;
  await page.exposeFunction('fixtureRegisterOperator', async (method: string, params: Record<string, unknown>) => {
    walletCall = { method, params };
    return { jsonrpc: '2.0', id: 'fixture', result: { txid } };
  });
  await page.addInitScript(({ origin, publicKey }) => {
    const cache = { addresses: { stx: [{ address: origin, symbol: 'STX' }], btc: [] }, version: '0.0.1' };
    localStorage.setItem('@stacks/connect', Array.from(new TextEncoder().encode(JSON.stringify(cache)), byte => byte.toString(16).padStart(2, '0')).join(''));
    localStorage.setItem('STX_PROVIDER', 'LeatherProvider');
    localStorage.setItem('ossr-ui:connected-stx-address', origin);
    localStorage.setItem('ossr-ui:connected-stx-public-key', publicKey);
    const fixtureWindow = window as unknown as {
      fixtureRegisterOperator: (method: string, params: Record<string, unknown>) => Promise<unknown>;
      LeatherProvider: unknown;
    };
    fixtureWindow.LeatherProvider = {
      request: (method: string, params: Record<string, unknown>) => fixtureWindow.fixtureRegisterOperator(method, params),
    };
  }, { origin, publicKey: originPublicKey });

  await page.goto('/operators');
  await page.getByLabel('Operator ID').fill(operatorId);
  await page.getByLabel('Quote-signing public key').fill(quotePublicKey);
  await page.getByLabel('Relay endpoint').fill(relayEndpoint);
  await page.getByRole('button', { name: 'Review and register for 10 STX' }).click();

  await expect(page.getByText('Registration submitted', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Track transaction' })).toHaveAttribute(
    'href',
    `https://explorer.hiro.so/txid/0x${txid}?chain=testnet`,
  );
  expect(walletCall?.method).toBe('stx_callContract');
  expect(walletCall?.params).toMatchObject({
    address: origin,
    contract: 'ST2SY3PZHMVQMYN1W4SBJ9MPHW4P8J01ST7TVQ68X.operators-registry-v7',
    functionName: 'register',
    network: 'testnet',
    postConditionMode: 'deny',
  });
  const args = walletCall?.params.functionArgs as string[];
  expect(args).toHaveLength(3);
  expect(args).toEqual([
    serializeCV(stringAsciiCV(operatorId)),
    serializeCV(bufferCV(Uint8Array.from(quotePublicKey.match(/.{2}/g)!.map(byte => Number.parseInt(byte, 16))))),
    serializeCV(stringAsciiCV(relayEndpoint)),
  ]);
  expect(walletCall?.params.postConditions).toHaveLength(1);
});
