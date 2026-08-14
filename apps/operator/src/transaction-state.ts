/**
 * Public lifecycle for one OSSR sponsorship.  These states describe the
 * independently observable stages of sponsorship and settlement; they are
 * deliberately not a synonym for a relay HTTP response.
 */
export const TRANSACTION_STATES = [
  'REQUESTED',
  'ACCEPTED',
  'SPONSORED',
  'BROADCAST',
  'CONFIRMED',
  'REIMBURSED',
  'REJECTED',
  'OPERATOR_UNAVAILABLE',
  'INSUFFICIENT_STX',
  'BROADCAST_FAILED',
  'CONFIRMATION_TIMEOUT',
  'REIMBURSEMENT_FAILED',
] as const;

export type TransactionState = typeof TRANSACTION_STATES[number];

export const TERMINAL_TRANSACTION_STATES = new Set<TransactionState>([
  'REIMBURSED',
  'REJECTED',
  'OPERATOR_UNAVAILABLE',
  'INSUFFICIENT_STX',
  'BROADCAST_FAILED',
  'CONFIRMATION_TIMEOUT',
  'REIMBURSEMENT_FAILED',
]);

const TRANSITIONS: Readonly<Record<TransactionState, readonly TransactionState[]>> = {
  REQUESTED: ['ACCEPTED', 'REJECTED', 'OPERATOR_UNAVAILABLE', 'INSUFFICIENT_STX'],
  ACCEPTED: ['SPONSORED', 'REJECTED', 'OPERATOR_UNAVAILABLE', 'INSUFFICIENT_STX'],
  SPONSORED: ['BROADCAST', 'BROADCAST_FAILED'],
  BROADCAST: ['CONFIRMED', 'REJECTED', 'CONFIRMATION_TIMEOUT'],
  CONFIRMED: ['REIMBURSED', 'REIMBURSEMENT_FAILED'],
  REIMBURSED: [],
  REJECTED: [],
  OPERATOR_UNAVAILABLE: [],
  INSUFFICIENT_STX: [],
  BROADCAST_FAILED: [],
  CONFIRMATION_TIMEOUT: [],
  REIMBURSEMENT_FAILED: [],
};

export function canTransitionTransactionState(from: TransactionState, to: TransactionState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Reject invalid or terminal-state mutations before they reach durable state. */
export function assertTransactionStateTransition(from: TransactionState, to: TransactionState): void {
  if (!canTransitionTransactionState(from, to)) {
    throw new Error(`Invalid OSSR transaction state transition: ${from} -> ${to}.`);
  }
}
