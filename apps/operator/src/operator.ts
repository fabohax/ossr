import {
  AuthType,
  broadcastTransaction,
  deserializeTransaction,
  fetchNonce,
  getAddressFromPrivateKey,
  sponsorTransaction,
} from '@stacks/transactions';
import { MemoryNonceStore, type NonceReservation, type NonceStore } from './nonce-store.js';

export type LogFields = Record<string, unknown>;
export type Logger = (event: string, fields?: LogFields) => void;

export type OperatorConfig = {
  /** Testnet only for the current OSSR PoC. */
  network: 'testnet';
  sponsorPrivateKey: string;
  /** Do not sponsor if the hot wallet would fall below this amount. */
  minimumBalanceMicroStx?: bigint;
  stacksApiUrl?: string;
  logger?: Logger;
  nonceStore?: NonceStore;
};

export type OperatorBalance = {
  address: string;
  availableMicroStx: bigint;
  lockedMicroStx: bigint;
};

export type OperatorHealth = {
  healthy: boolean;
  network: 'testnet';
  address: string;
  balanceMicroStx?: string;
  minimumBalanceMicroStx: string;
  reason?: string;
};

export type TransactionStatus = {
  txid: string;
  status: string;
  blockHeight?: number;
  raw: unknown;
};

export type SponsoredTransaction = { transaction: Uint8Array; txid: string; sponsorNonce: bigint };

export class OssrOperator {
  readonly address: string;
  private readonly apiUrl: string;
  private readonly minimumBalanceMicroStx: bigint;
  private readonly log: Logger;
  private nextSponsorNonce?: bigint;
  private nonceQueue: Promise<void> = Promise.resolve();
  private readonly nonceStore: NonceStore;

  constructor(private readonly config: OperatorConfig) {
    if (!config.sponsorPrivateKey.trim()) throw new Error('SPONSOR_PRIVATE_KEY is required.');
    this.address = getAddressFromPrivateKey(config.sponsorPrivateKey, config.network);
    this.apiUrl = (config.stacksApiUrl ?? 'https://api.testnet.hiro.so').replace(/\/$/, '');
    this.minimumBalanceMicroStx = config.minimumBalanceMicroStx ?? 0n;
    this.log = config.logger ?? jsonLogger;
    this.nonceStore = config.nonceStore ?? new MemoryNonceStore();
  }

  async balance(): Promise<OperatorBalance> {
    const response = await fetch(`${this.apiUrl}/extended/v1/address/${this.address}/stx`);
    if (!response.ok) throw new Error(`Could not read operator balance: HTTP ${response.status}`);
    const body = await response.json() as { balance?: string; locked?: string };
    if (!body.balance || !/^\d+$/.test(body.balance)) throw new Error('Stacks API returned an invalid STX balance.');
    const balance = {
      address: this.address,
      availableMicroStx: BigInt(body.balance),
      lockedMicroStx: BigInt(body.locked ?? '0'),
    };
    this.log('operator.balance', { address: balance.address, availableMicroStx: balance.availableMicroStx.toString() });
    return balance;
  }

  async health(): Promise<OperatorHealth> {
    try {
      const balance = await this.balance();
      const healthy = balance.availableMicroStx >= this.minimumBalanceMicroStx;
      const result: OperatorHealth = {
        healthy,
        network: this.config.network,
        address: this.address,
        balanceMicroStx: balance.availableMicroStx.toString(),
        minimumBalanceMicroStx: this.minimumBalanceMicroStx.toString(),
        reason: healthy ? undefined : 'operator STX balance is below the configured minimum',
      };
      this.log('operator.health', result);
      return result;
    } catch (error) {
      const result: OperatorHealth = {
        healthy: false,
        network: this.config.network,
        address: this.address,
        minimumBalanceMicroStx: this.minimumBalanceMicroStx.toString(),
        reason: message(error),
      };
      this.log('operator.health', result);
      return result;
    }
  }

  /**
   * Adds this operator's sponsor authorization. Calls are serialized so one
   * process never signs two transactions with the same sponsor nonce.
   */
  async sponsor(originSignedTransaction: string | Uint8Array, feeMicroStx: bigint): Promise<SponsoredTransaction> {
    if (feeMicroStx <= 0n) throw new Error('Sponsor fee must be greater than zero.');
    return this.withNonceLock(async () => {
      const signed = await this.signAtCurrentNonce(originSignedTransaction, feeMicroStx);
      await this.nonceStore.reserve(this.address, signed.sponsorNonce, signed.txid, 'SIGNED');
      this.nextSponsorNonce = signed.sponsorNonce + 1n;
      return signed;
    });
  }

  /**
   * Signs under the nonce lock, runs a fail-closed pre-broadcast check, and
   * broadcasts only if that check succeeds. A rejected check does not reserve
   * the sponsor nonce because the signed bytes never leave this process.
   */
  async sponsorAndBroadcast(
    originSignedTransaction: string | Uint8Array,
    feeMicroStx: bigint,
    beforeBroadcast: (signed: SponsoredTransaction) => Promise<void>,
  ): Promise<{ signed: SponsoredTransaction; broadcast: { txid: string } }> {
    if (feeMicroStx <= 0n) throw new Error('Sponsor fee must be greater than zero.');
    return this.withNonceLock(async () => {
      const signed = await this.signAtCurrentNonce(originSignedTransaction, feeMicroStx);
      await beforeBroadcast(signed);
      await this.nonceStore.reserve(this.address, signed.sponsorNonce, signed.txid, 'SIMULATED');
      this.nextSponsorNonce = signed.sponsorNonce + 1n;
      try {
        const broadcast = await this.broadcast(signed.transaction);
        await this.nonceStore.update(this.address, signed.txid, { status: 'BROADCAST', chainStatus: 'pending' });
        return { signed, broadcast };
      } catch (error) {
        await this.nonceStore.update(this.address, signed.txid, { status: 'AMBIGUOUS', failureReason: message(error) });
        throw error;
      }
    });
  }

  async nonceReservations(): Promise<NonceReservation[]> { return this.nonceStore.list(this.address); }

  async reconcileNonceReservations(): Promise<NonceReservation[]> {
    return this.withNonceLock(async () => {
      const records = await this.nonceStore.list(this.address);
      for (const record of records.filter(value => !['CONFIRMED', 'FAILED'].includes(value.status))) {
        try {
          const chain = await this.transactionStatus(record.txid);
          if (chain.status === 'success') {
            await this.nonceStore.update(this.address, record.txid, { status: 'CONFIRMED', chainStatus: chain.status, failureReason: undefined });
          } else if (chain.status.startsWith('abort_') || chain.status === 'dropped_replace_by_fee') {
            await this.nonceStore.update(this.address, record.txid, { status: 'FAILED', chainStatus: chain.status, failureReason: chain.status });
          } else if (chain.status === 'not_found') {
            await this.nonceStore.update(this.address, record.txid, { status: 'AMBIGUOUS', chainStatus: chain.status });
          } else {
            await this.nonceStore.update(this.address, record.txid, { chainStatus: chain.status });
          }
        } catch (error) {
          await this.nonceStore.update(this.address, record.txid, { status: 'AMBIGUOUS', failureReason: message(error) });
        }
      }
      return this.nonceStore.list(this.address);
    });
  }

  async broadcast(fullySignedTransaction: string | Uint8Array): Promise<{ txid: string }> {
    const transaction = deserializeTransaction(fullySignedTransaction);
    const result = await broadcastTransaction({
      transaction,
      network: this.config.network,
      client: { baseUrl: this.apiUrl },
    });
    if (!('txid' in result)) throw new Error(`Broadcast rejected: ${JSON.stringify(result)}`);
    this.log('operator.broadcast', { txid: result.txid });
    return { txid: result.txid };
  }

  async transactionStatus(txid: string): Promise<TransactionStatus> {
    if (!/^[0-9a-f]{64}$/i.test(txid)) throw new Error('Transaction ID must be a 64-character hexadecimal string.');
    const response = await fetch(`${this.apiUrl}/extended/v1/tx/${txid}`);
    if (response.status === 404) {
      const status = { txid, status: 'not_found', raw: null };
      this.log('operator.transaction_status', status);
      return status;
    }
    if (!response.ok) throw new Error(`Could not read transaction status: HTTP ${response.status}`);
    const raw = await response.json() as { tx_status?: string; block_height?: number };
    const status = { txid, status: raw.tx_status ?? 'unknown', blockHeight: raw.block_height, raw };
    this.log('operator.transaction_status', { txid, status: status.status, blockHeight: status.blockHeight });
    return status;
  }

  private async withNonceLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.nonceQueue;
    let release!: () => void;
    this.nonceQueue = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private async signAtCurrentNonce(originSignedTransaction: string | Uint8Array, feeMicroStx: bigint): Promise<SponsoredTransaction> {
    const balance = await this.balance();
    if (balance.availableMicroStx < feeMicroStx + this.minimumBalanceMicroStx) {
      throw new Error('Operator has insufficient STX for this fee and its configured balance reserve.');
    }
    const transaction = deserializeTransaction(originSignedTransaction);
    if (transaction.auth.authType !== AuthType.Sponsored) {
      throw new Error('Operator accepts only origin-signed sponsored transactions.');
    }
    const fetchedNonce = await fetchNonce({
      address: this.address,
      network: this.config.network,
      client: { baseUrl: this.apiUrl },
    });
    // External wallet activity can advance the account beyond our local cursor.
    // Keep the cursor as a floor for transactions we have already signed.
    const chainNonce = this.nextSponsorNonce !== undefined && this.nextSponsorNonce > fetchedNonce
      ? this.nextSponsorNonce
      : fetchedNonce;
    const sponsorNonce = await this.nonceStore.nextNonce(this.address, chainNonce);
    const signed = await sponsorTransaction({
      transaction,
      sponsorPrivateKey: this.config.sponsorPrivateKey,
      sponsorNonce,
      fee: feeMicroStx,
      network: this.config.network,
    });
    const serialized = signed.serializeBytes();
    const txid = signed.txid();
    this.log('operator.sponsored', { txid, sponsorNonce: sponsorNonce.toString(), feeMicroStx: feeMicroStx.toString() });
    return { transaction: serialized, txid, sponsorNonce };
  }
}

export const jsonLogger: Logger = (event, fields = {}) => {
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }));
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
