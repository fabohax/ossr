import assert from 'node:assert/strict';
import test from 'node:test';
import { relayAccessHeaders, setRelayAccessToken, clearRelayAccess } from './relay-access';
test('beta credentials stay scoped to the configured relay and clear explicitly', () => {
  setRelayAccessToken('https://one.example/', 'private-token');
  assert.deepEqual(relayAccessHeaders('https://one.example'), { Authorization: 'Bearer private-token' });
  assert.deepEqual(relayAccessHeaders('https://two.example'), {});
  setRelayAccessToken('https://one.example', '');
  assert.deepEqual(relayAccessHeaders('https://one.example'), {});
  setRelayAccessToken('/relay', 'private-token');
  clearRelayAccess();
  assert.deepEqual(relayAccessHeaders('/relay'), {});
});
