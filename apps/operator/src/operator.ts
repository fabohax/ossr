import {
  AuthType,
  broadcastTransaction,
  deserializeTransaction,
  fetchNonce,
  getAddressFromPrivateKey,
  sponsorTransaction,
} from '@stacks/transactions';

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

export class OssrOperator {
  readonly address: string;
  private readonly apiUrl: string;
  private readonly minimumBalanceMicroStx: bigint;
  private readonly log: Logger;
  private nextSponsorNonce?: bigint;
  private nonceQueue: Promise<void> = Promise.resolve();

  constructor(private readonly config: OperatorConfig) {
    if (!config.sponsorPrivateKey.trim()) throw new Error('SPONSOR_PRIVATE_KEY is required.');
    this.address = getAddressFromPrivateKey(config.sponsorPrivateKey, config.network);
    this.apiUrl = (config.stacksApiUrl ?? 'https://api.testnet.hiro.so').replace(/\/$/, '');
    this.minimumBalanceMicroStx = config.minimumBalanceMicroStx ?? 0n;
    this.log = config.logger ?? jsonLogger;
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
  async sponsor(originSignedTransaction: string | Uint8Array, feeMicroStx: bigint): Promise<{ transaction: Uint8Array; txid: string; sponsorNonce: bigint }> {
    if (feeMicroStx <= 0n) throw new Error('Sponsor fee must be greater than zero.');
    return this.withNonceLock(async () => {
      const balance = await this.balance();
      if (balance.availableMicroStx < feeMicroStx + this.minimumBalanceMicroStx) {
        throw new Error('Operator has insufficient STX for this fee and its configured balance reserve.');
      }

      const transaction = deserializeTransaction(originSignedTransaction);
      if (transaction.auth.authType !== AuthType.Sponsored) {
        throw new Error('Operator accepts only origin-signed sponsored transactions.');
      }

      const sponsorNonce = this.nextSponsorNonce ?? await fetchNonce({
        address: this.address,
        network: this.config.network,
        client: { baseUrl: this.apiUrl },
      });
      const signed = await sponsorTransaction({
        transaction,
        sponsorPrivateKey: this.config.sponsorPrivateKey,
        sponsorNonce,
        fee: feeMicroStx,
        network: this.config.network,
      });
      // Reserve locally only after signing. A failed signing attempt can retry
      // the chain nonce; a signed transaction must never be reused locally.
      this.nextSponsorNonce = sponsorNonce + 1n;
      const serialized = signed.serializeBytes();
      const txid = signed.txid();
      this.log('operator.sponsored', { txid, sponsorNonce: sponsorNonce.toString(), feeMicroStx: feeMicroStx.toString() });
      return { transaction: serialized, txid, sponsorNonce };
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
}

export const jsonLogger: Logger = (event, fields = {}) => {
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }));
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
