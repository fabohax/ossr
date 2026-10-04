import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonQuoteStore } from './quote-store.js';
import type { StoredQuote } from './api.js';

const directory = await mkdtemp(join(tmpdir(), 'ossr-quote-store-'));
const path = join(directory, 'quotes.json');

function storedQuote(quoteId: string): StoredQuote {
  return {
    quote: {
      protocolVersion: '1', quoteId, relayId: 'relay-test', network: 'testnet',
      sponsorPrincipal: 'ST000000000000000000002AMW42H', origin: 'ST000000000000000000002AMW42H',
      action: 'sbtc-transfer', reimbursementAsset: { assetId: 'sbtc', contract: 'ST000000000000000000002AMW42H.sbtc-token', unit: 'sat', decimals: '8' },
      adapterContract: 'ST000000000000000000002AMW42H.sbtc-sponsored-transfer-v1', functionName: 'sponsored-transfer',
      argumentsHash: `0x${'1'.repeat(64)}`, sponsorFee: '10', maxNetworkFeeMicroStx: '100000', issuedAtBlock: '100', expiresAtBlock: '110',
      policyVersion: 'test', keyId: 'test-key', signature: '00',
    },
    intent: { origin: 'ST000000000000000000002AMW42H', recipient: 'ST000000000000000000002AMW42H', amountSats: 100n, maxSponsorFeeSats: 20n },
  };
}

try {
  const quoteId = `0x${'a'.repeat(64)}`;
  const store = new JsonQuoteStore(path);
  await store.putIssued(storedQuote(quoteId));

  const reservations = await Promise.all([store.reserve(quoteId, 'request-a'), store.reserve(quoteId, 'request-a')]);
  assert.deepEqual(reservations.map(value => value?.kind).sort(), ['processing', 'reserved']);

  const result = { status: 'BROADCAST' as const, operator: 'ST000000000000000000002AMW42H', transaction_id: 'b'.repeat(64), fee_microstx: '1234' };
  await store.complete(quoteId, 'request-a', result);

  const restarted = new JsonQuoteStore(path);
  const retry = await restarted.reserve(quoteId, 'request-a');
  assert.equal(retry?.kind, 'completed');
  if (retry?.kind === 'completed') assert.deepEqual(retry.result, result);
  assert.equal((await restarted.reserve(quoteId, 'request-b'))?.kind, 'mismatch');
  assert.equal((await restarted.findByTransactionId(result.transaction_id))?.quote.quoteId, quoteId);

  const processingId = `0x${'c'.repeat(64)}`;
  await restarted.putIssued(storedQuote(processingId));
  assert.equal((await restarted.reserve(processingId, 'request-c'))?.kind, 'reserved');
  assert.equal((await new JsonQuoteStore(path).reserve(processingId, 'request-c'))?.kind, 'processing');

  const history = await new JsonQuoteStore(path).list();
  assert.equal(history.length, 2);
  assert.equal(history.find(record => record.quote.quoteId === quoteId)?.state, 'BROADCAST');
  history[0].quote.sponsorFee = '999';
  assert.equal((await restarted.get(quoteId))?.quote.sponsorFee, '10', 'history reads must not mutate authoritative records');

  const mode = (await stat(path)).mode & 0o777;
  assert.equal(mode, 0o600);
} finally {
  await rm(directory, { recursive: true });
}
