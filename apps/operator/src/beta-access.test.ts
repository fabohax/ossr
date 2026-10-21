import assert from 'node:assert/strict';
import test from 'node:test';
import { BetaAccess, betaAccessFromEnv, BetaAccessError, type BetaAccessConfig } from './beta-access.js';
const wallet = 'ST14MZ2VA0731Q6TEPK82FDQNHWKY8NPEMND33NE4';
const other = 'ST2QKEV89ZB3PCW1KC8206FDFJ7F6QANMR22ZG7F5';
const token = 'a'.repeat(43);
test('credentials authorize one wallet and rate limits reset at the next minute', () => {
  const gate = new BetaAccess({ walletTokens: { [wallet]: token }, requestsPerMinute: 2 });
  for (const authorization of [undefined, 'Bearer wrong', `Bearer ${'b'.repeat(43)}`]) assert.throws(() => gate.authenticate(authorization, 0), error => error instanceof BetaAccessError && error.status === 401);
  assert.equal(gate.authenticate(`Bearer ${token}`, 0), wallet);
  gate.bindOrigin(wallet, { origin: wallet }, 'quote');
  gate.bindOrigin(wallet, { user: wallet }, 'sponsor');
  assert.throws(() => gate.bindOrigin(wallet, { origin: other }, 'quote'), /does not authorize/);
  assert.throws(() => gate.bindOrigin(wallet, { user: other }, 'sponsor'), /does not authorize/);
  assert.throws(() => gate.requireWallet(other), /not invited/);
  assert.equal(gate.authenticate(`Bearer ${token}`, 59_999), wallet);
  assert.throws(() => gate.authenticate(`Bearer ${token}`, 59_999), error => error instanceof BetaAccessError && error.status === 429);
  assert.equal(gate.authenticate(`Bearer ${token}`, 60_000), wallet);
});
test('enabled beta fails closed for empty, invalid, duplicate and missing credentials', () => {
  assert.equal(betaAccessFromEnv({}), undefined);
  assert.throws(() => betaAccessFromEnv({ OSSR_BETA_ACCESS: 'true' }), /required/);
  assert.throws(() => betaAccessFromEnv({ OSSR_BETA_ACCESS: 'true', OSSR_BETA_WALLET_TOKENS: 'private credential malformed JSON' }), error => error instanceof Error && !error.message.includes('private credential'));
  const invalidConfigs: BetaAccessConfig[] = [{ walletTokens: {} }, { walletTokens: { [wallet]: 'short' } }, { walletTokens: { invalid: token } }, { walletTokens: { [wallet]: token, [other]: token } }, { walletTokens: { [wallet]: token }, requestsPerMinute: 0 }];
  for (const config of invalidConfigs) assert.throws(() => new BetaAccess(config));
});

test('HTTP gate rejects unauthenticated and mismatched sponsorships before relay processing', async () => {
  const { OssrRelayApi } = await import('./api.js');
  const { OssrOperator } = await import('./operator.js');
  const { once } = await import('node:events');
  const api = new OssrRelayApi({ operator: new OssrOperator({ network: 'testnet', sponsorPrivateKey: `${'1'.padStart(64, '0')}01`, logger: () => undefined }), betaAccess: { walletTokens: { [wallet]: token }, requestsPerMinute: 2 } });
  let processed = 0;
  api.quote = async () => { processed++; throw new Error('Processing must not be reached'); };
  api.sponsor = async () => { processed++; throw new Error('Simulation must not be reached'); };
  const server = api.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not start');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const endpoint of ['/v1/quotes', '/v1/sponsorships', '/v1/sponsor']) {
      const response = await fetch(`${base}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 401);
    }
    for (const endpoint of ['/v1/quotes', '/v1/sponsorships']) {
      const response = await fetch(`${base}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ origin: other, user: other }) });
      assert.equal(response.status, 403);
    }
    const limited = await fetch(`${base}/v1/quotes`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ origin: wallet }) });
    assert.equal(limited.status, 429);
    assert.equal(processed, 0);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('durable pause flag blocks new work and removal resumes the normal validation path', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { OssrRelayApi } = await import('./api.js');
  const { OssrOperator } = await import('./operator.js');
  const directory = await mkdtemp(join(tmpdir(), 'ossr-pause-'));
  const pauseFilePath = join(directory, 'paused');
  const api = new OssrRelayApi({ operator: new OssrOperator({ network: 'testnet', sponsorPrivateKey: `${'1'.padStart(64, '0')}01`, logger: () => undefined }), pauseFilePath });
  try {
    await writeFile(pauseFilePath, 'paused');
    await assert.rejects(api.quote({}), /paused new sponsorships/);
    await assert.rejects(api.sponsor({}), /paused new sponsorships/);
    // Recreating the process preserves the operator's pause decision.
    const restarted = new OssrRelayApi({ operator: new OssrOperator({ network: 'testnet', sponsorPrivateKey: `${'1'.padStart(64, '0')}01`, logger: () => undefined }), pauseFilePath });
    await assert.rejects(restarted.quote({}), /paused new sponsorships/);
    await rm(pauseFilePath);
    await assert.rejects(api.quote({}), /QUOTE_PRIVATE_KEY/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
