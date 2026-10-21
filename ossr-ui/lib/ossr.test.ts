import assert from 'node:assert/strict';
import test from 'node:test';
import { deserializeCV, cvToString, Pc, postConditionToHex } from '@stacks/transactions';
import { extractRawTransaction, normalizeRelayUrl, prepareWalletContractCall, requestQuote, RelayRequestError, NetworkRequestError, type Quote } from './ossr';
const origin = 'ST14MZ2VA0731Q6TEPK82FDQNHWKY8NPEMND33NE4';
const recipient = 'ST2QKEV89ZB3PCW1KC8206FDFJ7F6QANMR22ZG7F5';
const quote = { origin, adapterContract: `${origin}.adapter`, functionName: 'sponsored-transfer', sponsorFee: '10', quoteId: `0x${'ab'.repeat(32)}`, expiresAtBlock: '110', reimbursementAsset: { contract: `${origin}.sbtc-token` } } as Quote;
test('normalization and raw wallet parsing reject broadcast-only and malformed responses', () => {
  assert.equal(normalizeRelayUrl(' https://relay.example/ '), 'https://relay.example');
  for (const value of [null, {}, { transaction: 'abc' }, { txid: 'id', transaction: 'abcd' }, { result: { txId: 'id', txRaw: 'abcd' } }]) assert.equal(extractRawTransaction(value), undefined);
  assert.equal(extractRawTransaction({ result: { tx_raw: 'abcd' } }), '0xabcd');
});
test('wallet arguments and deny post-condition authorize exactly amount plus fee', () => {
  const call = prepareWalletContractCall({ quote, recipient, amountSats: '100', memo: '0x6869' });
  assert.equal(call.sponsored, true);
  assert.equal(call.postConditionMode, 'deny');
  assert.deepEqual(call.functionArgs.map(arg => cvToString(deserializeCV(arg))), ['u100', recipient, 'u10', quote.quoteId, 'u110', '(some 0x6869)']);
  assert.deepEqual(call.postConditions, [postConditionToHex(Pc.principal(origin).willSendEq(110n).ft(`${origin}.sbtc-token`, 'sbtc-token'))]);
  assert.equal(cvToString(deserializeCV(prepareWalletContractCall({ quote, recipient, amountSats: '100' }).functionArgs[5])), 'none');
  assert.throws(() => prepareWalletContractCall({ quote, recipient, amountSats: '100', memo: '0x1' }), /Invalid hex/);
});
test('relay error envelopes retain stable codes and transport failures retain submission context', async () => {
  const original = globalThis.fetch;
  try {
    for (const body of [{ error: { code: 'QUOTE_EXPIRED', message: 'expired' } }, { error: 'QUOTE_EXPIRED', message: 'expired' }]) {
      globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 422 });
      await assert.rejects(requestQuote({ relayUrl: 'https://relay.example', origin, recipient, amountSats: '100', maxSponsorFeeSats: '10' }), error => error instanceof RelayRequestError && error.code === 'QUOTE_EXPIRED' && error.status === 422);
    }
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    await assert.rejects(requestQuote({ relayUrl: 'https://relay.example', origin, recipient, amountSats: '100', maxSponsorFeeSats: '10' }), error => error instanceof NetworkRequestError && !error.submission);
  } finally { globalThis.fetch = original; }
});
