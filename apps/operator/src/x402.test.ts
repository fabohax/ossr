import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X402Payments, X402Error, encodePayment, x402ConfigFromEnv } from './x402.js';
import { OssrRelayApi } from './api.js';
import type { OssrOperator } from './operator.js';

const requirements = { scheme: 'exact' as const, network: 'eip155:84532', amount: '100', asset: 'token', payTo: 'recipient', maxTimeoutSeconds: 60 };
const config = { facilitatorUrl: 'https://facilitator.example', resourceUrl: 'https://relay.example/v1/sponsorships', requirements };
const payment = { x402Version: 2, accepted: requirements, payload: { signature: 'signed', authorization: { nonce: 'unique' } } };
const originalFetch = globalThis.fetch;
let calls: string[] = [];
let verify = true;
let settle = true;
let unavailable = false;
globalThis.fetch = async (url, init) => {
  if (unavailable) throw new Error('offline');
  const method = String(url).split('/').pop()!;
  calls.push(method);
  const body = JSON.parse(String(init?.body));
  assert.deepEqual(body.paymentRequirements, requirements);
  assert.equal(body.x402Version, 2);
  return Response.json(method === 'verify' ? { isValid: verify } : { success: settle, transaction: 'paid-tx', network: requirements.network });
};
const rejects = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => error instanceof X402Error && error.code === code);
try {
  assert.equal(x402ConfigFromEnv({}), undefined);
  assert.throws(() => x402ConfigFromEnv({ X402_ENABLED: 'true' }), /required/);
  assert.throws(() => new X402Payments({ ...config, requirements: { ...requirements, amount: '0' } }), /Invalid/);
  const payments = new X402Payments(config);
  await rejects(payments.authorize(undefined, {}), 'INVALID_PAYMENT');
  await rejects(payments.authorize('!!!', {}), 'INVALID_PAYMENT');
  await rejects(payments.authorize(encodePayment({ ...payment, x402Version: 1 }), {}), 'INVALID_PAYMENT');
  for (const field of ['network', 'amount', 'asset', 'payTo', 'scheme', 'maxTimeoutSeconds']) {
    await rejects(payments.authorize(encodePayment({ ...payment, accepted: { ...requirements, [field]: 'wrong' } }), {}), 'INVALID_PAYMENT');
  }
  assert.deepEqual(calls, []);
  verify = false;
  await rejects(payments.authorize(encodePayment(payment), {}), 'PAYMENT_INVALID');
  verify = true;
  const execute = await payments.authorize(encodePayment(payment), { quoteId: 'one' });
  assert.equal(calls.at(-1), 'verify');
  settle = false;
  await rejects(execute(), 'PAYMENT_SETTLEMENT_FAILED');
  settle = true;
  const receipt = await execute();
  assert.equal(receipt.transaction, 'paid-tx');
  calls = [];
  assert.deepEqual(await (await payments.authorize(encodePayment(payment), { quoteId: 'one' }))(), receipt);
  assert.deepEqual(calls, []);
  await rejects(payments.authorize(encodePayment(payment), { quoteId: 'two' }), 'PAYMENT_REPLAY');
  unavailable = true;
  await rejects(new X402Payments(config).authorize(encodePayment(payment), {}), 'PAYMENT_FACILITATOR_UNAVAILABLE');
  unavailable = false;

  const directory = await mkdtemp(join(tmpdir(), 'ossr-x402-'));
  try {
    const durableConfig = { ...config, storePath: join(directory, 'payments.json') };
    const first = new X402Payments(durableConfig);
    await (await first.authorize(encodePayment(payment), { durable: true }))();
    calls = [];
    const restarted = new X402Payments(durableConfig);
    assert.equal((await (await restarted.authorize(encodePayment(payment), { durable: true }))()).transaction, 'paid-tx');
    assert.deepEqual(calls, []);
    await rejects(restarted.authorize(encodePayment(payment), { durable: false }), 'PAYMENT_REPLAY');
    const racing = new X402Payments(config);
    const outcomes = await Promise.allSettled([
      racing.authorize(encodePayment(payment), { one: 1 }),
      racing.authorize(encodePayment(payment), { two: 2 }),
    ]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }

  // HTTP integration: challenge both aliases, exempt quotes, never sponsor invalid payments.
  const api = new OssrRelayApi({ operator: {} as OssrOperator, x402: config, corsAllowedOrigins: ['https://client.example'] });
  let sponsors = 0;
  api.sponsor = async (_input, beforeBroadcast) => {
    sponsors++;
    await beforeBroadcast?.();
    return { status: 'BROADCAST', operator: 'relay', transaction_id: 'stacks-tx', fee_microstx: '1' };
  };
  const server = api.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  // Use the real fetch for the relay, mocked fetch for facilitator calls.
  const request = (path: string, signature?: string) => originalFetch(`http://127.0.0.1:${address.port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://client.example', ...(signature ? { 'PAYMENT-SIGNATURE': signature } : {}) }, body: JSON.stringify({ quoteId: 'one' }) });
  try {
    for (const path of ['/v1/sponsorships', '/v1/sponsor']) {
      const response = await request(path);
      assert.equal(response.status, 402);
      assert.equal(JSON.parse(Buffer.from(response.headers.get('payment-required')!, 'base64').toString()).x402Version, 2);
      assert.match(response.headers.get('access-control-expose-headers')!, /PAYMENT-RESPONSE/);
    }
    assert.equal(sponsors, 0);
    assert.equal((await request('/v1/sponsorships', 'bad')).status, 402);
    assert.equal(sponsors, 0);
    const paid = await request('/v1/sponsorships', encodePayment(payment));
    assert.equal(paid.status, 201);
    assert.equal(JSON.parse(Buffer.from(paid.headers.get('payment-response')!, 'base64').toString()).success, true);
    assert.equal(sponsors, 1);
    const quote = await request('/v1/quotes');
    assert.equal(quote.status, 503);
    assert.equal(quote.headers.get('payment-required'), null);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
} finally { globalThis.fetch = originalFetch; }
console.log('x402 payment tests passed');
