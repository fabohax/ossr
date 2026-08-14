import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  AddressHashMode,
  AddressVersion,
  AuthType,
  PayloadType,
  addressFromVersionHash,
  addressToString,
  deserializeTransaction,
  estimateTransactionByteLength,
  validateStacksAddress,
} from '@stacks/transactions';
import { OssrOperator } from './operator.js';
import { SbtcReimbursementService } from './reimbursement.js';

const MAX_BODY_BYTES = 256 * 1024;
const HEX = /^0x(?:[0-9a-fA-F]{2})+$/;

export type RelayApiConfig = {
  operator: OssrOperator;
  stacksApiUrl?: string;
  /** Reject fees above this amount even when the estimator returns one. */
  maximumFeeMicroStx?: bigint;
  /** Allows applications to add a stricter transaction policy. */
  validateTransaction?: (transaction: ReturnType<typeof deserializeTransaction>) => void;
  logger?: (event: string, fields?: Record<string, unknown>) => void;
  /** Optional Day 7 worker. It pays and tracks sBTC after sponsorship confirms. */
  reimbursementService?: SbtcReimbursementService;
  reimbursementPollIntervalMs?: number;
};

export type SponsorResponse = {
  /** The request has passed validation, sponsorship, and broadcast. */
  status: 'BROADCAST';
  operator: string;
  transaction_id: string;
  fee_microstx: string;
  sponsorship_id?: string;
};

/**
 * Minimal Day 4 HTTP relay. It intentionally does not expose completed
 * transaction bytes: the relay signs and broadcasts in the same request.
 */
export class OssrRelayApi {
  private readonly stacksApiUrl: string;
  private readonly maximumFeeMicroStx: bigint;
  private readonly log: NonNullable<RelayApiConfig['logger']>;

  constructor(private readonly config: RelayApiConfig) {
    this.stacksApiUrl = (config.stacksApiUrl ?? 'https://api.testnet.hiro.so').replace(/\/$/, '');
    this.maximumFeeMicroStx = config.maximumFeeMicroStx ?? 100_000n;
    this.log = config.logger ?? (() => undefined);
  }

  createServer(): Server {
    const server = createServer((request, response) => void this.handle(request, response));
    if (this.config.reimbursementService) {
      const interval = setInterval(() => void this.reconcileReimbursements(), this.config.reimbursementPollIntervalMs ?? 10_000);
      interval.unref();
      server.once('close', () => clearInterval(interval));
      void this.reconcileReimbursements();
    }
    return server;
  }

  async sponsor(input: unknown): Promise<SponsorResponse> {
    this.log('relay.transaction_state', { status: 'REQUESTED' });
    const { transaction: encoded, user } = parseSponsorRequest(input);
    const transaction = deserializeOriginTransaction(encoded, user);
    this.config.validateTransaction?.(transaction);
    defaultTransactionPolicy(transaction);
    this.log('relay.transaction_state', { status: 'ACCEPTED' });

    const health = await this.config.operator.health();
    if (!health.healthy) throw new RelayError(503, 'OPERATOR_UNAVAILABLE', health.reason ?? 'Operator is unavailable.');

    const feeMicroStx = await this.estimateFee(transaction);
    if (feeMicroStx <= 0n || feeMicroStx > this.maximumFeeMicroStx) {
      throw new RelayError(422, 'FEE_OUT_OF_POLICY', 'Estimated network fee is outside relay policy.');
    }

    const sponsored = await this.config.operator.sponsor(encoded, feeMicroStx);
    this.log('relay.transaction_state', { status: 'SPONSORED', transactionId: sponsored.txid });
    const broadcast = await this.config.operator.broadcast(sponsored.transaction);
    const sponsorshipId = broadcast.txid;
    if (this.config.reimbursementService) {
      await this.config.reimbursementService.create({ sponsorshipId, stacksTxId: broadcast.txid, feePaidMicroStx: feeMicroStx });
    }
    const result = { status: 'BROADCAST' as const, operator: this.config.operator.address, transaction_id: broadcast.txid, fee_microstx: feeMicroStx.toString(), sponsorship_id: this.config.reimbursementService ? sponsorshipId : undefined };
    this.log('relay.transaction_state', { status: 'BROADCAST', transactionId: broadcast.txid });
    return result;
  }

  private async estimateFee(transaction: ReturnType<typeof deserializeTransaction>): Promise<bigint> {
    const response = await fetch(`${this.stacksApiUrl}/v2/fees/transfer`, { headers: { Accept: 'text/plain' } });
    if (!response.ok) throw new RelayError(503, 'FEE_UNAVAILABLE', `Fee estimator returned HTTP ${response.status}.`);
    const rate = (await response.text()).trim();
    if (!/^[0-9]+$/.test(rate)) throw new RelayError(503, 'FEE_UNAVAILABLE', 'Fee estimator returned an invalid rate.');
    return BigInt(rate) * BigInt(estimateTransactionByteLength(transaction));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const reimbursementMatch = request.url?.match(/^\/v1\/reimbursements\/([0-9a-f]{64})$/i);
    if (request.method === 'GET' && reimbursementMatch && this.config.reimbursementService) {
      try {
        const record = await this.config.reimbursementService.reconcile(reimbursementMatch[1]);
        if (!record) { respond(response, 404, { error: 'NOT_FOUND', message: 'Reimbursement not found.' }); return; }
        respond(response, 200, record);
      } catch (error) {
        const relayError = toRelayError(error);
        respond(response, relayError.status, { error: relayError.code, message: relayError.message });
      }
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/sponsor') {
      respond(response, 404, { error: 'NOT_FOUND', message: 'Use POST /v1/sponsor.' });
      return;
    }
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      respond(response, 415, { error: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json.' });
      return;
    }
    try {
      respond(response, 200, await this.sponsor(await readJson(request)));
    } catch (error) {
      const relayError = toRelayError(error);
      this.log('relay.sponsor.rejected', { code: relayError.code, message: relayError.message });
      respond(response, relayError.status, { error: relayError.code, message: relayError.message });
    }
  }

  private async reconcileReimbursements(): Promise<void> {
    try { await this.config.reimbursementService?.reconcilePending(); }
    catch (error) { this.log('reimbursement.reconcile_failed', { message: error instanceof Error ? error.message : String(error) }); }
  }
}

export function createRelayServer(config: RelayApiConfig): Server {
  return new OssrRelayApi(config).createServer();
}

function parseSponsorRequest(input: unknown): { transaction: string; user: string } {
  if (!isRecord(input) || Object.keys(input).length !== 2 || typeof input.transaction !== 'string' || typeof input.user !== 'string') {
    throw new RelayError(400, 'INVALID_REQUEST', 'Body must contain only string transaction and user properties.');
  }
  if (!HEX.test(input.transaction)) throw new RelayError(400, 'INVALID_TRANSACTION', 'transaction must be an even-length 0x-prefixed hexadecimal string.');
  if (!validateStacksAddress(input.user)) throw new RelayError(400, 'INVALID_USER', 'user must be a valid canonical Stacks address.');
  return { transaction: input.transaction, user: input.user };
}

function deserializeOriginTransaction(encoded: string, user: string): ReturnType<typeof deserializeTransaction> {
  let transaction: ReturnType<typeof deserializeTransaction>;
  try { transaction = deserializeTransaction(encoded); } catch { throw new RelayError(400, 'INVALID_TRANSACTION', 'transaction could not be decoded.'); }
  if (transaction.chainId !== 0x80000000) throw new RelayError(422, 'WRONG_NETWORK', 'Only Stacks testnet transactions are supported.');
  if (transaction.auth.authType !== AuthType.Sponsored) throw new RelayError(422, 'UNSUPPORTED_AUTH', 'transaction must use sponsored authorization.');
  try { transaction.verifyOrigin(); } catch { throw new RelayError(422, 'INVALID_ORIGIN_SIGNATURE', 'transaction has an invalid origin signature.'); }
  const expectedUser = originAddress(transaction);
  if (user !== expectedUser) throw new RelayError(422, 'ORIGIN_MISMATCH', 'user does not match the transaction origin.');
  return transaction;
}

function originAddress(transaction: ReturnType<typeof deserializeTransaction>): string {
  const condition = transaction.auth.spendingCondition;
  const singleSig = condition.hashMode === AddressHashMode.P2PKH || condition.hashMode === AddressHashMode.P2WPKH;
  return addressToString(addressFromVersionHash(singleSig ? AddressVersion.TestnetSingleSig : AddressVersion.TestnetMultiSig, condition.signer));
}

function defaultTransactionPolicy(transaction: ReturnType<typeof deserializeTransaction>): void {
  if (transaction.payload.payloadType !== PayloadType.TokenTransfer) {
    throw new RelayError(422, 'UNSUPPORTED_TRANSACTION', 'This relay currently sponsors STX token transfers only.');
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new RelayError(413, 'REQUEST_TOO_LARGE', 'Request body exceeds 256 KiB.');
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RelayError(400, 'INVALID_JSON', 'Request body must be valid JSON.'); }
}

function respond(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

class RelayError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function toRelayError(error: unknown): RelayError {
  if (error instanceof RelayError) return error;
  const message = error instanceof Error ? error.message : 'Unexpected relay failure.';
  if (/insufficient STX/i.test(message)) return new RelayError(503, 'INSUFFICIENT_STX', message);
  if (/broadcast rejected/i.test(message)) return new RelayError(502, 'BROADCAST_FAILED', message);
  return new RelayError(503, 'SPONSORSHIP_FAILED', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
