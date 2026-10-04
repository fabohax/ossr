import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidRelayUrl } from './relay-url.ts';

test('accepts the production HTTPS relay proxy', () => {
  assert.equal(isValidRelayUrl('/relay', 'https://ossr.network'), true);
  assert.equal(isValidRelayUrl('/relay'), true);
  assert.equal(isValidRelayUrl('https://relay.ossr.network', 'https://ossr.network'), true);
});

test('rejects mixed content while allowing local HTTP development', () => {
  assert.equal(isValidRelayUrl('http://localhost:3002', 'https://ossr.network'), false);
  assert.equal(isValidRelayUrl('http://localhost:3002', 'http://localhost:3000'), true);
});

test('rejects ambiguous hosts, unsupported schemes, credentials and URL suffixes', () => {
  for (const value of ['//other.example', '/\\other.example', 'relay', '', 'ftp://relay.example',
    'https://user:password@relay.example', '/relay?other=1', '/relay#fragment']) {
    assert.equal(isValidRelayUrl(value, 'https://ossr.network'), false, value);
  }
});
