import assert from 'node:assert/strict';
import { calculateReimbursement, validateReimbursementPolicy } from './reimbursement.js';

const policy = {
  rateNumerator: 1n,
  rateDenominator: 100n,
  markupBps: 500n,
  failureReserveSats: 2n,
  minimumReimbursementSats: 10n,
  maximumReimbursementSats: 1_000n,
};

const quote = calculateReimbursement(4_200n, policy);
assert.deepEqual(quote, {
  networkFeeMicroStx: 4_200n,
  convertedNetworkCostSats: 42n,
  markupSats: 3n,
  failureReserveSats: 2n,
  minimumAdjustmentSats: 0n,
  reimbursementSats: 47n,
});

assert.equal(calculateReimbursement(1n, policy).reimbursementSats, 10n);
assert.throws(() => calculateReimbursement(100_000n, policy), /exceeds maximum/);
assert.throws(() => validateReimbursementPolicy({ ...policy, rateDenominator: 0n }), /rateDenominator/);
assert.throws(() => validateReimbursementPolicy({ ...policy, markupBps: 10_001n }), /markupBps/);
