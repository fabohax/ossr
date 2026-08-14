import assert from 'node:assert/strict';
import { assertTransactionStateTransition, canTransitionTransactionState, TERMINAL_TRANSACTION_STATES } from './transaction-state.js';

assert.equal(canTransitionTransactionState('REQUESTED', 'ACCEPTED'), true);
assert.equal(canTransitionTransactionState('BROADCAST', 'CONFIRMED'), true);
assert.equal(canTransitionTransactionState('CONFIRMED', 'REIMBURSED'), true);
assert.equal(canTransitionTransactionState('ACCEPTED', 'BROADCAST'), false);
assert.equal(TERMINAL_TRANSACTION_STATES.has('REIMBURSED'), true);
assert.equal(TERMINAL_TRANSACTION_STATES.has('BROADCAST'), false);
assert.throws(() => assertTransactionStateTransition('REIMBURSED', 'CONFIRMED'), /Invalid OSSR transaction state transition/);
