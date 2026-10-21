import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BetaBudget, BetaBudgetError, betaBudgetFromEnv, type BetaBudgetConfig } from './beta-budget.js';
const txid = 'ab'.repeat(32);
const time = new Date('2026-10-14T12:00:00Z');
const input = { quoteId: 'quote1', origin: 'wallet1', recipient: 'recipient', amountSats: '100', sponsorFeeSats: '1', reservedMicroStx: '50' };
function config(storePath: string, overrides: Partial<BetaBudgetConfig> = {}): BetaBudgetConfig { return { storePath, maximumTransferSats: 100n, walletDailyOutflowSats: 1000n, dailyOutflowSats: 10000n, dailySponsorMicroStx: 1000n, unreimbursedMicroStx: 1000n, timeZone: 'America/Lima', ...overrides }; }
async function fixture(operation: (path: string) => Promise<void>) { const directory = await mkdtemp(join(tmpdir(), 'ossr-budget-')); try { await operation(join(directory, 'ledger.json')); } finally { await rm(directory, { recursive: true, force: true }); } }
const matches = (code: string) => (error: unknown) => error instanceof BetaBudgetError && error.code === code;
test('concurrent reservations enforce durable wallet, relay, fee and unreimbursed-exposure limits', async () => {
  for (const [field, value, code] of [['walletDailyOutflowSats', 101n, 'BETA_WALLET_LIMIT'], ['dailyOutflowSats', 101n, 'BETA_DAILY_LIMIT'], ['dailySponsorMicroStx', 50n, 'BETA_STX_BUDGET'], ['unreimbursedMicroStx', 50n, 'BETA_LOSS_CAP']] as const) {
    await fixture(async path => {
      const settings = config(path, { [field]: value });
      const budget = new BetaBudget(settings);
      const outcomes = await Promise.allSettled([budget.reserve(input, time), budget.reserve({ ...input, quoteId: 'quote2' }, time)]);
      assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
      const rejected = outcomes.find(outcome => outcome.status === 'rejected');
      assert.ok(rejected?.status === 'rejected' && matches(code)(rejected.reason));
      const restarted = new BetaBudget(settings);
      await assert.rejects(restarted.reserve({ ...input, quoteId: 'quote3' }, time), matches(code));
      assert.equal((await restarted.snapshot()).length, 1);
    });
  }
});
test('daily quotas reset in the configured zone; unresolved exposure does not reset', async () => {
  await fixture(async path => {
    const budget = new BetaBudget(config(path, { dailyOutflowSats: 101n, unreimbursedMicroStx: 100n }));
    await budget.reserve(input, time);
    await assert.rejects(budget.reserve({ ...input, quoteId: 'quote2' }, time), matches('BETA_DAILY_LIMIT'));
    await budget.reserve({ ...input, quoteId: 'quote2' }, new Date('2026-10-15T12:00:00Z'));
    await assert.rejects(budget.reserve({ ...input, quoteId: 'quote3' }, new Date('2026-10-16T12:00:00Z')), matches('BETA_LOSS_CAP'));
    assert.throws(() => budget.checkTransfer(101n), matches('BETA_TRANSFER_LIMIT'));
  });
});
test('quote/transaction identity is immutable and unknown signed work cannot be retried', async () => {
  await fixture(async path => {
    const budget = new BetaBudget(config(path));
    await budget.reserve(input, time); await budget.reserve(input, time);
    assert.equal((await budget.snapshot()).length, 1);
    await assert.rejects(budget.reserve({ ...input, amountSats: '90' }, time), matches('BETA_RESERVATION_MISMATCH'));
    await budget.attachTransaction(input.quoteId, txid);
    await assert.rejects(budget.attachTransaction(input.quoteId, 'cd'.repeat(32)), matches('BETA_RESERVATION_MISMATCH'));
    await budget.recordFailure(input.quoteId, 'SIMULATION_STALE');
    const restarted = new BetaBudget(config(path));
    await assert.rejects(restarted.reserve(input, time), matches('BETA_RESERVATION_PENDING'));
    assert.equal((await restarted.snapshot())[0].failureCode, 'SIMULATION_STALE');
  });
});
function receipt(outcome = 'success') { return { tx_id: `0x${txid}`, tx_status: outcome, sender_address: input.origin, sponsor_address: 'sponsor', sponsored: true, fee_rate: '40', event_count: 2, events: [{ event_type: 'fungible_token_asset', fungible_token_asset: { asset_event_type: 'transfer', asset_id: 'asset::sbtc-token', sender: input.origin, recipient: 'sponsor', amount: '1' } }, { event_type: 'fungible_token_asset', fungible_token_asset: { asset_event_type: 'transfer', asset_id: 'asset::sbtc-token', sender: input.origin, recipient: input.recipient, amount: '100' } }] }; }
test('chain accounting reconciles actual fee and exact reimbursement; aborts retain sponsor loss', async () => {
  for (const outcome of ['success', 'abort_by_response']) await fixture(async path => {
    const budget = new BetaBudget(config(path, { unreimbursedMicroStx: 50n }));
    await budget.reserve(input, time); await budget.attachTransaction(input.quoteId, txid);
    await budget.reconcile(txid, { tx_status: 'not_found' }, 'sponsor', 'asset::sbtc-token');
    assert.equal((await budget.snapshot())[0].actualMicroStx, undefined);
    await budget.reconcile(txid, receipt(outcome), 'sponsor', 'asset::sbtc-token');
    const settled = (await new BetaBudget(config(path)).snapshot())[0];
    assert.equal(settled.actualMicroStx, '40'); assert.equal(settled.reimbursedSats, outcome === 'success' ? '1' : '0');
    await budget.reconcile(txid, receipt(outcome), 'sponsor', 'asset::sbtc-token');
    const another = { ...input, quoteId: 'another', reservedMicroStx: '20' };
    if (outcome === 'success') await budget.reserve(another, time);
    else await assert.rejects(budget.reserve(another, time), matches('BETA_LOSS_CAP'));
    await assert.rejects(budget.reconcile(txid, { ...receipt(outcome), fee_rate: '41' }, 'sponsor', 'asset::sbtc-token'), matches('BETA_ACCOUNTING_MISMATCH'));
    await assert.rejects(budget.reserve({ ...input, quoteId: 'after-changed-receipt', reservedMicroStx: '20' }, time), matches('BETA_LOSS_CAP'));
    assert.equal((await budget.snapshot())[0].failureCode, 'BETA_ACCOUNTING_MISMATCH');
  });
});
test('mismatched/truncated/corrupt receipts and ledgers fail closed', async () => {
  await fixture(async path => {
    const budget = new BetaBudget(config(path));
    await budget.reserve(input, time); await budget.attachTransaction(input.quoteId, txid);
    await assert.rejects(budget.reconcile(txid, { ...receipt(), sender_address: 'other' }, 'sponsor', 'asset::sbtc-token'), matches('BETA_ACCOUNTING_MISMATCH'));
    await assert.rejects(budget.reconcile(txid, { ...receipt(), event_count: 3 }, 'sponsor', 'asset::sbtc-token'), matches('BETA_ACCOUNTING_INCOMPLETE'));
    await assert.rejects(budget.reconcile(txid, { ...receipt(), event_count: 3, events: [...receipt().events, { event_type: 'stx_asset', stx_asset: { sender: input.origin, recipient: 'other', amount: '1' } }] }, 'sponsor', 'asset::sbtc-token'), matches('BETA_ACCOUNTING_MISMATCH'));
    assert.equal((await budget.snapshot())[0].actualMicroStx, undefined);
    await writeFile(path, '[{}]');
    await assert.rejects(new BetaBudget(config(path)).ready(), /Malformed/);
  });
  assert.equal(betaBudgetFromEnv({}), undefined);
  assert.throws(() => betaBudgetFromEnv({ OSSR_BETA_BUDGETS: 'true' }), /explicitly configured/);
});

test('relay integration reserves before signing, rejects excess outflow, and reuses completed quotes', async () => {
  await fixture(async path => {
    const { OssrRelayApi } = await import('./api.js');
    const { OssrOperator } = await import('./operator.js');
    const { makeContractCall, getAddressFromPrivateKey, Pc, uintCV, standardPrincipalCV, bufferCV, noneCV, deserializeTransaction } = await import('@stacks/transactions');
    const originKey = `${'3'.padStart(64, '0')}01`;
    const sponsorKey = `${'2'.padStart(64, '0')}01`;
    const origin = getAddressFromPrivateKey(originKey, 'testnet');
    const sponsor = getAddressFromPrivateKey(sponsorKey, 'testnet');
    const recipient = getAddressFromPrivateKey(`${'4'.padStart(64, '0')}01`, 'testnet');
    const operator = new OssrOperator({ network: 'testnet', sponsorPrivateKey: sponsorKey, logger: () => undefined });
    let broadcasts = 0;
    operator.broadcast = async raw => { broadcasts++; return { txid: deserializeTransaction(raw).txid() }; };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async value => {
      const url = String(value);
      if (url.endsWith('/v2/info')) return new Response(JSON.stringify({ stacks_tip_height: 100 }));
      if (url.endsWith('/nonces')) return new Response(JSON.stringify({ possible_next_nonce: 0 }));
      if (url.endsWith('/stx')) return new Response(JSON.stringify({ balance: '1000000' }));
      if (url.endsWith('/v2/fees/transfer')) return new Response('1');
      throw new Error(`Unexpected fixture RPC: ${url}`);
    };
    try {
      const settings = config(path, { walletDailyOutflowSats: 101n });
      const relay = new OssrRelayApi({ operator, betaBudget: settings, betaAccountingToken: 'z'.repeat(43), quotePrivateKey: sponsorKey, adapterContractAddress: sponsor, adapterContractName: 'sbtc-sponsored-transfer-v1', sbtcContractAddress: sponsor, sbtcContractName: 'sbtc-token', sponsorFeeSats: 1n, simulateTransaction: async () => undefined });
      await assert.rejects(relay.quote({ origin, recipient, amountSats: '101', maxSponsorFeeSats: '1' }), matches('BETA_TRANSFER_LIMIT'));
      const response = await relay.quote({ origin, recipient, amountSats: '100', maxSponsorFeeSats: '1' });
      const quote = response.quote;
      const signed = await makeContractCall({ contractAddress: sponsor, contractName: 'sbtc-sponsored-transfer-v1', functionName: 'sponsored-transfer', functionArgs: [uintCV(100), standardPrincipalCV(recipient), uintCV(1), bufferCV(Buffer.from(quote.quoteId.slice(2), 'hex')), uintCV(BigInt(quote.expiresAtBlock)), noneCV()], postConditionMode: 'deny', postConditions: [Pc.principal(origin).willSendEq(101n).ft(`${sponsor}.sbtc-token`, 'sbtc-token')], senderKey: originKey, fee: 0n, nonce: 0n, sponsored: true, network: 'testnet' });
      const submission = { quoteId: quote.quoteId, user: origin, transaction: `0x${signed.serialize()}` };
      const result = await relay.sponsor(submission);
      assert.deepEqual(await relay.sponsor(submission), result);
      assert.equal(broadcasts, 1);
      const ledger = await new BetaBudget(settings).snapshot();
      assert.equal(ledger.length, 1); assert.equal(ledger[0].txid, result.transaction_id);
      const another = await relay.quote({ origin, recipient, amountSats: '1', maxSponsorFeeSats: '1' });
      const transaction = await makeContractCall({ contractAddress: sponsor, contractName: 'sbtc-sponsored-transfer-v1', functionName: 'sponsored-transfer', functionArgs: [uintCV(1), standardPrincipalCV(recipient), uintCV(1), bufferCV(Buffer.from(another.quote.quoteId.slice(2), 'hex')), uintCV(BigInt(another.quote.expiresAtBlock)), noneCV()], postConditionMode: 'deny', postConditions: [Pc.principal(origin).willSendEq(2n).ft(`${sponsor}.sbtc-token`, 'sbtc-token')], senderKey: originKey, fee: 0n, nonce: 1n, sponsored: true, network: 'testnet' });
      await assert.rejects(relay.sponsor({ quoteId: another.quote.quoteId, user: origin, transaction: `0x${transaction.serialize()}` }), matches('BETA_WALLET_LIMIT'));
      assert.equal(broadcasts, 1);
      operator.transactionStatus = async id => ({ txid: id, status: 'success', raw: { tx_id: `0x${id}`, tx_status: 'success', sponsored: true, sender_address: origin, sponsor_address: sponsor, fee_rate: result.fee_microstx, event_count: 2, events: [{ event_type: 'fungible_token_asset', fungible_token_asset: { asset_event_type: 'transfer', asset_id: `${sponsor}.sbtc-token::sbtc-token`, sender: origin, recipient: sponsor, amount: '1' } }, { event_type: 'fungible_token_asset', fungible_token_asset: { asset_event_type: 'transfer', asset_id: `${sponsor}.sbtc-token::sbtc-token`, sender: origin, recipient, amount: '100' } }] } });
      const server = relay.createServer();
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Accounting test server did not bind');
      try {
        const url = `http://127.0.0.1:${address.port}/v1/beta/accounting`;
        assert.equal((await originalFetch(url)).status, 403);
        assert.equal((await originalFetch(url, { headers: { Authorization: `Bearer ${'z'.repeat(43)}`, 'X-Forwarded-For': '203.0.113.1' } })).status, 403);
        const response = await originalFetch(url, { headers: { Authorization: `Bearer ${'z'.repeat(43)}` } });
        assert.equal(response.status, 200);
        const accounting = await response.json() as { entries: { actualMicroStx: string; reimbursedSats: string; recipientPaidSats: string }[]; alerts: unknown[] };
        assert.equal(accounting.entries[0].actualMicroStx, result.fee_microstx);
        assert.equal(accounting.entries[0].reimbursedSats, '1');
        assert.equal(accounting.entries[0].recipientPaidSats, '100');
        assert.deepEqual(accounting.alerts, []);
      } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    } finally { globalThis.fetch = originalFetch; }
  });
});
