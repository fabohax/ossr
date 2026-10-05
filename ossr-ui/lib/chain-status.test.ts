import assert from 'node:assert/strict';
import test from 'node:test';
import { describeChainStatus, isFailedChainStatus, isTerminalChainStatus } from './ossr.ts';

test('repeated mempool drops keep polling until a chain receipt arrives', () => {
  const observations = Array(20).fill('dropped_replace_by_fee').concat('success');
  const consumed: string[] = [];
  for (const status of observations) {
    consumed.push(status);
    assert.equal(isFailedChainStatus(status), false);
    if (isTerminalChainStatus(status)) break;
  }
  assert.deepEqual(consumed, observations);
});

test('only execution receipts are terminal; uncertain statuses remain provisional', () => {
  for (const status of [undefined, 'pending', 'not_found', 'dropped_replace_by_fee', 'dropped_stale_garbage_collect', 'dropped_problematic']) {
    assert.equal(isTerminalChainStatus(status), false, status);
    assert.equal(isFailedChainStatus(status), false, status);
  }
  for (const status of ['abort_by_response', 'abort_by_post_condition']) {
    assert.equal(isTerminalChainStatus(status), true);
    assert.equal(isFailedChainStatus(status), true);
  }
  assert.equal(isTerminalChainStatus('success'), true);
  assert.equal(isFailedChainStatus('success'), false);
});

test('drop message preserves uncertainty and discourages duplicate transfers', () => {
  const message = describeChainStatus({ transactionId: 'abc', status: 'dropped_replace_by_fee' });
  assert.match(message, /still being checked/);
  assert.match(message, /do not resubmit/);
});
