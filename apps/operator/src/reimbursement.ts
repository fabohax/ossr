import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  broadcastTransaction,
  fetchNonce,
  getAddressFromPrivateKey,
  makeContractCall,
  noneCV,
  standardPrincipalCV,
  uintCV,
} from '@stacks/transactions';
import { calculateReimbursement, type ReimbursementPolicy } from '../../../packages/sbtc/src/reimbursement.js';
import type { OssrOperator } from './operator.js';
import {
  assertTransactionStateTransition,
  TERMINAL_TRANSACTION_STATES,
  type TransactionState,
} from './transaction-state.js';

/** @deprecated Use TransactionState. Kept as an alias for API consumers. */
export type ReimbursementStatus = TransactionState;

/** Values are decimal strings so this record can safely be persisted as JSON. */
export type ReimbursementRecord = {
  sponsorship_id: string;
  stacks_tx_id: string;
  operator: string;
  fee_paid: string;
  reimbursement_amount: string;
  reimbursement_tx_id?: string;
  status: ReimbursementStatus;
  created_at: string;
  updated_at: string;
  failure_reason?: string;
};

export interface ReimbursementStore {
  get(sponsorshipId: string): Promise<ReimbursementRecord | undefined>;
  put(record: ReimbursementRecord): Promise<void>;
  list(): Promise<ReimbursementRecord[]>;
}

/** A deliberately small durable store for the single-process testnet PoC. */
export class JsonReimbursementStore implements ReimbursementStore {
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly path: string) {}

  async get(sponsorshipId: string): Promise<ReimbursementRecord | undefined> {
    return (await this.records())[sponsorshipId];
  }
  async list(): Promise<ReimbursementRecord[]> { return Object.values(await this.records()); }
  async put(record: ReimbursementRecord): Promise<void> {
    const previous = this.writes;
    let release!: () => void;
    this.writes = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      const records = await this.records();
      records[record.sponsorship_id] = record;
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, JSON.stringify(records, null, 2) + '\n', { mode: 0o600 });
      await rename(temporary, this.path);
    } finally { release(); }
  }
  private async records(): Promise<Record<string, ReimbursementRecord>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      return Object.fromEntries(Object.entries(parsed as Record<string, ReimbursementRecord>).map(([id, record]) => [id, normalizeRecord(record)]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new Error(`Could not read reimbursement store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Read Day 7 records without turning an in-flight reimbursement into an unknown state. */
function normalizeRecord(record: ReimbursementRecord): ReimbursementRecord {
  const legacy: Record<string, TransactionState> = {
    pending_confirmation: 'BROADCAST',
    payment_broadcast: 'CONFIRMED',
    confirmed: 'REIMBURSED',
    sponsorship_failed: 'REJECTED',
    reimbursement_failed: 'REIMBURSEMENT_FAILED',
  };
  const status = legacy[record.status] ?? record.status;
  return { ...record, status, created_at: record.created_at ?? record.updated_at };
}

export type ReimbursementServiceConfig = {
  operator: OssrOperator;
  /** Account that owns the sBTC being paid to the sponsor; testnet PoC only. */
  payerPrivateKey: string;
  policy: ReimbursementPolicy;
  store: ReimbursementStore;
  stacksApiUrl?: string;
  sbtcContractAddress?: string;
  sbtcContractName?: string;
  paymentFeeMicroStx?: bigint;
  /** Mark a broadcast transaction unresolved after this duration. Defaults to 24 hours. */
  confirmationTimeoutMs?: number;
  logger?: (event: string, fields?: Record<string, unknown>) => void;
};

const DEFAULT_SBTC_ADDRESS = 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4';

export class SbtcReimbursementService {
  private readonly apiUrl: string;
  private readonly payer: string;
  private readonly log: NonNullable<ReimbursementServiceConfig['logger']>;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly config: ReimbursementServiceConfig) {
    if (!config.payerPrivateKey.trim()) throw new Error('REIMBURSEMENT_PAYER_PRIVATE_KEY is required.');
    this.apiUrl = (config.stacksApiUrl ?? 'https://api.testnet.hiro.so').replace(/\/$/, '');
    this.payer = getAddressFromPrivateKey(config.payerPrivateKey, 'testnet');
    this.log = config.logger ?? (() => undefined);
  }

  async create(input: { sponsorshipId: string; stacksTxId: string; feePaidMicroStx: bigint }): Promise<ReimbursementRecord> {
    if (!input.sponsorshipId.trim()) throw new Error('sponsorshipId is required.');
    if (!/^[0-9a-f]{64}$/i.test(input.stacksTxId)) throw new Error('stacksTxId must be a 64-character hexadecimal string.');
    if (input.feePaidMicroStx <= 0n) throw new Error('feePaidMicroStx must be greater than zero.');
    const existing = await this.config.store.get(input.sponsorshipId);
    if (existing) return existing;
    const quote = calculateReimbursement(input.feePaidMicroStx, this.config.policy);
    const record: ReimbursementRecord = {
      sponsorship_id: input.sponsorshipId,
      stacks_tx_id: input.stacksTxId,
      operator: this.config.operator.address,
      fee_paid: input.feePaidMicroStx.toString(),
      reimbursement_amount: quote.reimbursementSats.toString(),
      status: 'BROADCAST',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await this.config.store.put(record);
    this.log('reimbursement.created', record);
    return record;
  }

  async reconcile(sponsorshipId: string): Promise<ReimbursementRecord | undefined> {
    return this.serialized(async () => {
      const record = await this.config.store.get(sponsorshipId);
      if (!record || TERMINAL_TRANSACTION_STATES.has(record.status)) return record;
      if (record.status === 'BROADCAST') {
        const sponsored = await this.config.operator.transactionStatus(record.stacks_tx_id);
        if (sponsored.status === 'success') return this.broadcastPayment(await this.transition(record, 'CONFIRMED'));
        if (sponsored.status.startsWith('abort_') || sponsored.status === 'dropped_replace_by_fee') {
          return this.transition(record, 'REJECTED', `Sponsored transaction ${sponsored.status}`);
        }
        if (Date.now() - Date.parse(record.created_at) >= (this.config.confirmationTimeoutMs ?? 86_400_000)) {
          return this.transition(record, 'CONFIRMATION_TIMEOUT', 'Sponsored transaction was not confirmed before the deadline.');
        }
        return record;
      }
      if (record.status !== 'CONFIRMED') throw new Error(`Unknown active transaction state: ${record.status}`);
      if (!record.reimbursement_tx_id) return this.transition(record, 'REIMBURSEMENT_FAILED', 'Payment transaction ID is missing.');
      const payment = await this.config.operator.transactionStatus(record.reimbursement_tx_id);
      if (payment.status === 'success') return this.transition(record, 'REIMBURSED');
      if (payment.status.startsWith('abort_') || payment.status === 'dropped_replace_by_fee') {
        return this.transition(record, 'REIMBURSEMENT_FAILED', `sBTC payment ${payment.status}`);
      }
      return record;
    });
  }

  async reconcilePending(): Promise<ReimbursementRecord[]> {
    const records = await this.config.store.list();
    const result: ReimbursementRecord[] = [];
    for (const record of records) if (!TERMINAL_TRANSACTION_STATES.has(record.status)) {
      const updated = await this.reconcile(record.sponsorship_id);
      if (updated) result.push(updated);
    }
    return result;
  }

  private async broadcastPayment(record: ReimbursementRecord): Promise<ReimbursementRecord> {
    try {
      const nonce = await fetchNonce({ address: this.payer, network: 'testnet', client: { baseUrl: this.apiUrl } });
      const transaction = await makeContractCall({
        contractAddress: this.config.sbtcContractAddress ?? DEFAULT_SBTC_ADDRESS,
        contractName: this.config.sbtcContractName ?? 'sbtc-token',
        functionName: 'transfer',
        functionArgs: [uintCV(BigInt(record.reimbursement_amount)), standardPrincipalCV(this.payer), standardPrincipalCV(record.operator), noneCV()],
        senderKey: this.config.payerPrivateKey,
        nonce,
        fee: this.config.paymentFeeMicroStx ?? 10_000n,
        network: 'testnet',
      });
      const broadcast = await broadcastTransaction({ transaction, network: 'testnet', client: { baseUrl: this.apiUrl } });
      if (!('txid' in broadcast)) throw new Error(`sBTC payment rejected: ${JSON.stringify(broadcast)}`);
      return this.save({ ...record, reimbursement_tx_id: broadcast.txid });
    } catch (error) {
      return this.transition(record, 'REIMBURSEMENT_FAILED', error instanceof Error ? error.message : String(error));
    }
  }

  private async transition(record: ReimbursementRecord, status: TransactionState, failureReason?: string): Promise<ReimbursementRecord> {
    assertTransactionStateTransition(record.status, status);
    return this.save({ ...record, status, failure_reason: failureReason });
  }

  private async save(record: ReimbursementRecord): Promise<ReimbursementRecord> {
    const updated = { ...record, updated_at: new Date().toISOString() };
    await this.config.store.put(updated);
    this.log('reimbursement.updated', updated);
    return updated;
  }
  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue; let release!: () => void;
    this.queue = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
}
