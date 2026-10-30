import assert from 'node:assert/strict';
import test from 'node:test';
import { extractQuoteDistribution, registryLookupFunctionNames } from './operator-registry.ts';

test('extracts quote keys from relay metadata', () => {
  const keys = extractQuoteDistribution({
    quoteKeys: [
      { keyId: 'quote-1', publicKey: '02' + '11'.repeat(32), status: 'active' },
      { keyId: 'quote-2', publicKey: '03' + '22'.repeat(32), status: 'inactive' },
    ],
    relayId: 'fixture-relay',
  });

  assert.equal(keys.length, 2);
  assert.equal(keys[0].keyId, 'quote-1');
  assert.equal(keys[0].publicKey.startsWith('02'), true);
  assert.equal(keys[1].status, 'inactive');
});

test('includes the likely registry lookup functions', () => {
  assert.ok(registryLookupFunctionNames.includes('get-operator'));
  assert.ok(registryLookupFunctionNames.includes('get-registration'));
});
