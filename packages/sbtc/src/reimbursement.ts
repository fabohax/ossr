/**
 * Deterministic, integer-only sBTC reimbursement pricing for OSSR v0.1.
 *
 * All amounts are smallest units: microSTX for network cost and sats for
 * reimbursement.  The exchange rate is a rational number of sats/microSTX so
 * no IEEE-754 number can change a user-visible quote.
 */
export type ReimbursementPolicy = {
  /** sats per microSTX = rateNumerator / rateDenominator */
  rateNumerator: bigint;
  rateDenominator: bigint;
  /** Operator margin, charged on the converted STX network cost. */
  markupBps: bigint;
  /** Flat amount retained to cover confirmed abort losses. */
  failureReserveSats: bigint;
  /** Lower bound for an accepted quote. */
  minimumReimbursementSats: bigint;
  /** Upper bound enforced by the adapter and relay policy. */
  maximumReimbursementSats: bigint;
};

export type ReimbursementQuote = {
  networkFeeMicroStx: bigint;
  convertedNetworkCostSats: bigint;
  markupSats: bigint;
  failureReserveSats: bigint;
  minimumAdjustmentSats: bigint;
  reimbursementSats: bigint;
};

const BASIS_POINTS = 10_000n;

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function requireNonNegative(name: string, value: bigint): void {
  if (value < 0n) throw new RangeError(`${name} must not be negative.`);
}

/** Validates static policy values before a relay issues any quotes. */
export function validateReimbursementPolicy(policy: ReimbursementPolicy): void {
  requireNonNegative('rateNumerator', policy.rateNumerator);
  requireNonNegative('markupBps', policy.markupBps);
  requireNonNegative('failureReserveSats', policy.failureReserveSats);
  requireNonNegative('minimumReimbursementSats', policy.minimumReimbursementSats);
  requireNonNegative('maximumReimbursementSats', policy.maximumReimbursementSats);
  if (policy.rateNumerator === 0n) throw new RangeError('rateNumerator must be greater than zero.');
  if (policy.rateDenominator <= 0n) throw new RangeError('rateDenominator must be greater than zero.');
  if (policy.markupBps > BASIS_POINTS) throw new RangeError('markupBps must not exceed 10,000.');
  if (policy.minimumReimbursementSats === 0n) throw new RangeError('minimumReimbursementSats must be greater than zero.');
  if (policy.minimumReimbursementSats > policy.maximumReimbursementSats) {
    throw new RangeError('minimumReimbursementSats must not exceed maximumReimbursementSats.');
  }
}

/**
 * Calculates the exact sponsor fee committed to a quote:
 * max(minimum, ceil(networkFee * rate) + markup + reserve).
 *
 * The reserve is added before applying the minimum so a configured minimum is
 * the user-visible all-in minimum, rather than an additional hidden charge.
 */
export function calculateReimbursement(
  networkFeeMicroStx: bigint,
  policy: ReimbursementPolicy,
): ReimbursementQuote {
  validateReimbursementPolicy(policy);
  if (networkFeeMicroStx <= 0n) throw new RangeError('networkFeeMicroStx must be greater than zero.');

  const convertedNetworkCostSats = ceilDivide(
    networkFeeMicroStx * policy.rateNumerator,
    policy.rateDenominator,
  );
  const markupSats = ceilDivide(convertedNetworkCostSats * policy.markupBps, BASIS_POINTS);
  const pricedSats = convertedNetworkCostSats + markupSats + policy.failureReserveSats;
  const reimbursementSats = pricedSats < policy.minimumReimbursementSats
    ? policy.minimumReimbursementSats
    : pricedSats;

  if (reimbursementSats > policy.maximumReimbursementSats) {
    throw new RangeError('Calculated reimbursement exceeds maximumReimbursementSats.');
  }

  return {
    networkFeeMicroStx,
    convertedNetworkCostSats,
    markupSats,
    failureReserveSats: policy.failureReserveSats,
    minimumAdjustmentSats: reimbursementSats - pricedSats,
    reimbursementSats,
  };
}
