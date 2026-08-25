import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import {
  AddressHashMode,
  AddressVersion,
  AuthType,
  bufferCV,
  contractPrincipalCV,
  cvToString,
  PayloadType,
  addressFromVersionHash,
  addressToString,
  deserializeTransaction,
  estimateTransactionByteLength,
  hashStructuredData,
  noneCV,
  principalCV,
  privateKeyToPublic,
  publicKeyToHex,
  signStructuredData,
  someCV,
  stringAsciiCV,
  tupleCV,
  uintCV,
  validateStacksAddress,
} from '@stacks/transactions';
import { OssrOperator } from './operator.js';
import { SbtcReimbursementService } from './reimbursement.js';
import { OperatorRegistry, type OperatorRegistryReader, toEntry } from './registry.js';

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
  /** Optional Day 9 discovery registry. It is read-only from the relay API. */
  registry?: OperatorRegistryReader;
  /** Enables operator health mutation endpoints and relay outcome tracking. */
  healthRegistry?: OperatorRegistry;
  operatorId?: string;
  healthPollIntervalMs?: number;
  quotePrivateKey?: string;
  quoteKeyId?: string;
  relayId?: string;
  policyVersion?: string;
  adapterContractAddress?: string;
  adapterContractName?: string;
  sbtcContractAddress?: string;
  sbtcContractName?: string;
  quoteLifetimeBlocks?: bigint;
  sponsorFeeSats?: bigint;
  corsAllowedOrigins?: string[];
};

export type SponsorResponse = {
  /** The request has passed validation, sponsorship, and broadcast. */
  status: 'BROADCAST';
  operator: string;
  transaction_id: string;
  fee_microstx: string;
  sponsorship_id?: string;
};

export type SbtcTransferQuote = {
  protocolVersion: '1';
  quoteId: string;
  relayId: string;
  network: 'testnet';
  sponsorPrincipal: string;
  origin: string;
  action: 'sbtc-transfer';
  reimbursementAsset: { assetId: 'sbtc'; contract: string; unit: 'sat'; decimals: '8' };
  adapterContract: string;
  functionName: 'sponsored-transfer';
  argumentsHash: string;
  sponsorFee: string;
  maxNetworkFeeMicroStx: string;
  issuedAtBlock: string;
  expiresAtBlock: string;
  policyVersion: string;
  keyId: string;
};

export type QuoteResponse = {
  quote: SbtcTransferQuote & { signature: string };
  quotePublicKey: string;
};

type StoredQuote = {
  quote: SbtcTransferQuote & { signature: string };
  intent: QuoteIntent;
  consumedBy?: string;
};

type QuoteIntent = {
  origin: string;
  recipient: string;
  amountSats: bigint;
  maxSponsorFeeSats: bigint;
  memo?: string;
};

/**
 * Minimal Day 4 HTTP relay. It intentionally does not expose completed
 * transaction bytes: the relay signs and broadcasts in the same request.
 */
export class OssrRelayApi {
  private readonly stacksApiUrl: string;
  private readonly maximumFeeMicroStx: bigint;
  private readonly healthPollIntervalMs: number;
  private readonly log: NonNullable<RelayApiConfig['logger']>;
  private readonly corsAllowedOrigins: string[];
  private readonly quotes = new Map<string, StoredQuote>();

  constructor(private readonly config: RelayApiConfig) {
    this.stacksApiUrl = (config.stacksApiUrl ?? 'https://api.testnet.hiro.so').replace(/\/$/, '');
    this.maximumFeeMicroStx = config.maximumFeeMicroStx ?? 100_000n;
    this.healthPollIntervalMs = config.healthPollIntervalMs ?? 10_000;
    if (!Number.isSafeInteger(this.healthPollIntervalMs) || this.healthPollIntervalMs < 1) throw new Error('healthPollIntervalMs must be a positive safe integer.');
    this.log = config.logger ?? (() => undefined);
    this.corsAllowedOrigins = config.corsAllowedOrigins ?? parseCorsOrigins(process.env.OSSR_CORS_ALLOWED_ORIGINS);
  }

  createServer(): Server {
    const server = createServer((request, response) => void this.handle(request, response));
    if (this.config.reimbursementService) {
      const interval = setInterval(() => void this.reconcileReimbursements(), this.config.reimbursementPollIntervalMs ?? 10_000);
      interval.unref();
      server.once('close', () => clearInterval(interval));
      void this.reconcileReimbursements();
    }
    if (this.config.healthRegistry) {
      const interval = setInterval(() => void this.config.healthRegistry?.list(), this.healthPollIntervalMs);
      interval.unref();
      server.once('close', () => clearInterval(interval));
    }
    return server;
  }

  async sponsor(input: unknown): Promise<SponsorResponse> {
    this.log('relay.transaction_state', { status: 'REQUESTED' });
    const { transaction: encoded, user, quoteId } = parseSponsorRequest(input);
    const quote = quoteId ? this.requireUsableQuote(quoteId, user) : undefined;
    const transaction = deserializeOriginTransaction(encoded, user);
    this.config.validateTransaction?.(transaction);
    defaultTransactionPolicy(transaction);
    if (quote) validateTransactionAgainstQuote(transaction, quote);
    this.log('relay.transaction_state', { status: 'ACCEPTED' });

    const health = await this.config.operator.health();
    if (!health.healthy) throw new RelayError(503, 'OPERATOR_UNAVAILABLE', health.reason ?? 'Operator is unavailable.');

    const feeMicroStx = await this.estimateFee(transaction);
    if (feeMicroStx <= 0n || feeMicroStx > this.maximumFeeMicroStx) {
      throw new RelayError(422, 'FEE_OUT_OF_POLICY', 'Estimated network fee is outside relay policy.');
    }

    let sponsored: Awaited<ReturnType<OssrOperator['sponsor']>>;
    let broadcast: Awaited<ReturnType<OssrOperator['broadcast']>>;
    try {
      sponsored = await this.config.operator.sponsor(encoded, feeMicroStx);
      this.log('relay.transaction_state', { status: 'SPONSORED', transactionId: sponsored.txid });
      broadcast = await this.config.operator.broadcast(sponsored.transaction);
    } catch (error) {
      await this.recordFailure();
      throw error;
    }
    await this.recordSuccess(broadcast.txid);
    if (quote) quote.consumedBy = broadcast.txid;
    const sponsorshipId = broadcast.txid;
    if (this.config.reimbursementService) {
      await this.config.reimbursementService.create({ sponsorshipId, stacksTxId: broadcast.txid, feePaidMicroStx: feeMicroStx });
    }
    const result = { status: 'BROADCAST' as const, operator: this.config.operator.address, transaction_id: broadcast.txid, fee_microstx: feeMicroStx.toString(), sponsorship_id: this.config.reimbursementService ? sponsorshipId : undefined };
    this.log('relay.transaction_state', { status: 'BROADCAST', transactionId: broadcast.txid });
    return result;
  }

  async info(): Promise<object> {
    const adapterContract = this.adapterContract();
    const sbtcContract = this.sbtcContract();
    return {
      apiVersion: '1',
      relayId: this.config.relayId ?? this.config.operatorId ?? this.config.operator.address,
      network: 'testnet',
      sponsorPrincipal: this.config.operator.address,
      supportedActions: ['sbtc-transfer'],
      adapterContract,
      sbtcContract,
      limits: {
        maxNetworkFeeMicroStx: this.maximumFeeMicroStx.toString(),
        quoteLifetimeBlocks: this.quoteLifetimeBlocks().toString(),
        sponsorFeeSats: this.sponsorFeeSats().toString(),
      },
      quoteKeys: this.config.quotePrivateKey ? [{
        keyId: this.config.quoteKeyId ?? 'dev-quote-key',
        publicKey: this.quotePublicKey(),
        status: 'active',
      }] : [],
      quotesEnabled: Boolean(this.config.quotePrivateKey && adapterContract && sbtcContract),
      sponsorshipsEnabled: true,
    };
  }

  async quote(input: unknown): Promise<QuoteResponse> {
    if (!this.config.quotePrivateKey) throw new RelayError(503, 'QUOTES_DISABLED', 'QUOTE_PRIVATE_KEY is not configured.');
    const intent = parseQuoteRequest(input);
    const adapterContract = this.adapterContract();
    const sbtcContract = this.sbtcContract();
    if (!adapterContract || !sbtcContract) throw new RelayError(503, 'QUOTE_POLICY_INCOMPLETE', 'Adapter and sBTC contract configuration are required.');
    const sponsorFee = this.sponsorFeeSats();
    if (sponsorFee > intent.maxSponsorFeeSats) throw new RelayError(422, 'SPONSOR_FEE_TOO_HIGH', 'Quoted sponsor fee exceeds maxSponsorFeeSats.');
    const issuedAt = await this.currentStacksHeight();
    const expiresAt = issuedAt + this.quoteLifetimeBlocks();
    const quoteId = `0x${randomBytes(32).toString('hex')}`;
    const unsigned: SbtcTransferQuote = {
      protocolVersion: '1',
      quoteId,
      relayId: this.config.relayId ?? this.config.operatorId ?? this.config.operator.address,
      network: 'testnet',
      sponsorPrincipal: this.config.operator.address,
      origin: intent.origin,
      action: 'sbtc-transfer',
      reimbursementAsset: { assetId: 'sbtc', contract: sbtcContract, unit: 'sat', decimals: '8' },
      adapterContract,
      functionName: 'sponsored-transfer',
      argumentsHash: argumentsHash({ ...intent, quoteId, sponsorFee, expiresAt }),
      sponsorFee: sponsorFee.toString(),
      maxNetworkFeeMicroStx: this.maximumFeeMicroStx.toString(),
      issuedAtBlock: issuedAt.toString(),
      expiresAtBlock: expiresAt.toString(),
      policyVersion: this.config.policyVersion ?? 'dev',
      keyId: this.config.quoteKeyId ?? 'dev-quote-key',
    };
    const quote = { ...unsigned, signature: signStructuredData({ message: quoteMessageCV(unsigned), domain: quoteDomainCV(), privateKey: this.config.quotePrivateKey }) };
    this.quotes.set(quote.quoteId, { quote, intent });
    return { quote, quotePublicKey: this.quotePublicKey() };
  }

  private async estimateFee(transaction: ReturnType<typeof deserializeTransaction>): Promise<bigint> {
    const response = await fetch(`${this.stacksApiUrl}/v2/fees/transfer`, { headers: { Accept: 'text/plain' } });
    if (!response.ok) throw new RelayError(503, 'FEE_UNAVAILABLE', `Fee estimator returned HTTP ${response.status}.`);
    const rate = (await response.text()).trim();
    if (!/^[0-9]+$/.test(rate)) throw new RelayError(503, 'FEE_UNAVAILABLE', 'Fee estimator returned an invalid rate.');
    return BigInt(rate) * BigInt(estimateTransactionByteLength(transaction));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'OPTIONS') {
      respondOptions(request, response, this.corsAllowedOrigins);
      return;
    }
    if (request.method === 'GET' && request.url === '/v1/info') {
      respond(request, response, 200, await this.info(), this.corsAllowedOrigins);
      return;
    }
    if (request.method === 'GET' && request.url === '/health/live') {
      respond(request, response, 200, { status: 'ok' }, this.corsAllowedOrigins);
      return;
    }
    if (request.method === 'GET' && request.url === '/health/ready') {
      const health = await this.config.operator.health();
      respond(request, response, health.healthy ? 200 : 503, { status: health.healthy ? 'ready' : 'not_ready', operator: health }, this.corsAllowedOrigins);
      return;
    }
    if (request.method === 'POST' && request.url === '/operator/heartbeat' && this.config.healthRegistry) {
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        respond(request, response, 415, { error: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json.' }, this.corsAllowedOrigins);
        return;
      }
      try {
        const heartbeat = parseHeartbeatRequest(await readJson(request));
        respond(request, response, 200, toEntry(await this.config.healthRegistry.heartbeat(heartbeat.operatorId, {
          stxBalanceMicroStx: BigInt(heartbeat.stxBalanceMicroStx),
          recentSuccessfulTransactions: heartbeat.recentSuccessfulTransactions,
        })), this.corsAllowedOrigins);
      } catch (error) {
        const relayError = toRelayError(error);
        respond(request, response, relayError.status, { error: relayError.code, message: relayError.message }, this.corsAllowedOrigins);
      }
      return;
    }
    const operatorsMatch = request.url?.match(/^\/v1\/operators\/([^/?#]+)$/);
    if (request.method === 'GET' && request.url === '/v1/operators' && this.config.registry) {
      respond(request, response, 200, { operators: (await this.config.registry.list()).map(toEntry) }, this.corsAllowedOrigins);
      return;
    }
    if (request.method === 'GET' && operatorsMatch && this.config.registry) {
      const operator = await this.config.registry.get(decodeURIComponent(operatorsMatch[1]));
      if (!operator) { respond(request, response, 404, { error: 'NOT_FOUND', message: 'Operator not found.' }, this.corsAllowedOrigins); return; }
      respond(request, response, 200, toEntry(operator), this.corsAllowedOrigins);
      return;
    }
    const sponsorshipMatch = request.url?.match(/^\/v1\/sponsorships\/0x([0-9a-f]{64})$/i);
    if (request.method === 'GET' && sponsorshipMatch) {
      try {
        const status = await this.config.operator.transactionStatus(sponsorshipMatch[1]);
        const stored = [...this.quotes.values()].find(quote => quote.consumedBy === sponsorshipMatch[1]);
        respond(request, response, 200, { transactionId: `0x${sponsorshipMatch[1]}`, quoteId: stored?.quote.quoteId, status: status.status, blockHeight: status.blockHeight, raw: status.raw }, this.corsAllowedOrigins);
      } catch (error) {
        const relayError = toRelayError(error);
        respond(request, response, relayError.status, { error: relayError.code, message: relayError.message }, this.corsAllowedOrigins);
      }
      return;
    }
    const reimbursementMatch = request.url?.match(/^\/v1\/reimbursements\/([0-9a-f]{64})$/i);
    if (request.method === 'GET' && reimbursementMatch && this.config.reimbursementService) {
      try {
        const record = await this.config.reimbursementService.reconcile(reimbursementMatch[1]);
        if (!record) { respond(request, response, 404, { error: 'NOT_FOUND', message: 'Reimbursement not found.' }, this.corsAllowedOrigins); return; }
        respond(request, response, 200, record, this.corsAllowedOrigins);
      } catch (error) {
        const relayError = toRelayError(error);
        respond(request, response, relayError.status, { error: relayError.code, message: relayError.message }, this.corsAllowedOrigins);
      }
      return;
    }
    if (request.method !== 'POST' || (request.url !== '/v1/sponsor' && request.url !== '/v1/sponsorships' && request.url !== '/v1/quotes')) {
      respond(request, response, 404, { error: 'NOT_FOUND', message: 'Use /v1/info, POST /v1/quotes, POST /v1/sponsorships, or GET /v1/sponsorships/{txid}.' }, this.corsAllowedOrigins);
      return;
    }
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      respond(request, response, 415, { error: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json.' }, this.corsAllowedOrigins);
      return;
    }
    try {
      if (request.url === '/v1/quotes') {
        respond(request, response, 201, await this.quote(await readJson(request)), this.corsAllowedOrigins);
      } else {
        const result = await this.sponsor(await readJson(request));
        respond(request, response, request.url === '/v1/sponsorships' ? 201 : 200, {
          ...result,
          transactionId: `0x${result.transaction_id}`,
          feeMicroStx: result.fee_microstx,
        }, this.corsAllowedOrigins);
      }
    } catch (error) {
      const relayError = toRelayError(error);
      this.log('relay.sponsor.rejected', { code: relayError.code, message: relayError.message });
      respond(request, response, relayError.status, { error: relayError.code, message: relayError.message }, this.corsAllowedOrigins);
    }
  }

  private async reconcileReimbursements(): Promise<void> {
    try { await this.config.reimbursementService?.reconcilePending(); }
    catch (error) { this.log('reimbursement.reconcile_failed', { message: error instanceof Error ? error.message : String(error) }); }
  }

  private async recordSuccess(txid: string): Promise<void> {
    if (this.config.healthRegistry && this.config.operatorId) await this.config.healthRegistry.recordSuccess(this.config.operatorId, txid);
  }

  private async recordFailure(): Promise<void> {
    if (this.config.healthRegistry && this.config.operatorId) await this.config.healthRegistry.recordFailure(this.config.operatorId);
  }

  private adapterContract(): string | undefined {
    const address = this.config.adapterContractAddress ?? process.env.ADAPTER_CONTRACT_ADDRESS?.trim();
    const name = this.config.adapterContractName ?? process.env.ADAPTER_CONTRACT_NAME?.trim() ?? 'sbtc-sponsored-transfer-v1';
    return address ? `${address}.${name}` : undefined;
  }

  private sbtcContract(): string | undefined {
    const address = this.config.sbtcContractAddress ?? process.env.SBTC_CONTRACT_ADDRESS?.trim() ?? 'SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1';
    const name = this.config.sbtcContractName ?? process.env.SBTC_CONTRACT_NAME?.trim() ?? 'sbtc-token';
    return `${address}.${name}`;
  }

  private quoteLifetimeBlocks(): bigint {
    return this.config.quoteLifetimeBlocks ?? BigInt(process.env.QUOTE_TTL_BLOCKS ?? '10');
  }

  private sponsorFeeSats(): bigint {
    return this.config.sponsorFeeSats ?? BigInt(process.env.SBTC_SPONSOR_FEE_SATS ?? process.env.REIMBURSEMENT_OPERATOR_SATS ?? '10');
  }

  private quotePublicKey(): string {
    if (!this.config.quotePrivateKey) return '';
    return `0x${publicKeyToHex(privateKeyToPublic(this.config.quotePrivateKey))}`;
  }

  private async currentStacksHeight(): Promise<bigint> {
    const response = await fetch(`${this.stacksApiUrl}/v2/info`);
    if (!response.ok) throw new RelayError(503, 'STACKS_INFO_UNAVAILABLE', `Stacks info returned HTTP ${response.status}.`);
    const body = await response.json() as { stacks_tip_height?: number };
    if (typeof body.stacks_tip_height !== 'number' || !Number.isSafeInteger(body.stacks_tip_height)) throw new RelayError(503, 'STACKS_INFO_UNAVAILABLE', 'Stacks info did not include a valid tip height.');
    return BigInt(body.stacks_tip_height);
  }

  private requireUsableQuote(quoteId: string, origin: string): StoredQuote {
    const stored = this.quotes.get(quoteId);
    if (!stored) throw new RelayError(404, 'QUOTE_NOT_FOUND', 'Quote was not issued by this relay process.');
    if (stored.consumedBy) throw new RelayError(409, 'QUOTE_ALREADY_USED', 'Quote has already been consumed.');
    if (stored.quote.origin !== origin) throw new RelayError(422, 'QUOTE_ORIGIN_MISMATCH', 'Quote origin does not match submitted user.');
    return stored;
  }
}

export function createRelayServer(config: RelayApiConfig): Server {
  return new OssrRelayApi(config).createServer();
}

function parseSponsorRequest(input: unknown): { transaction: string; user: string; quoteId?: string } {
  if (!isRecord(input) || typeof input.transaction !== 'string' || typeof input.user !== 'string') {
    throw new RelayError(400, 'INVALID_REQUEST', 'Body must contain string transaction and user properties.');
  }
  if (!HEX.test(input.transaction)) throw new RelayError(400, 'INVALID_TRANSACTION', 'transaction must be an even-length 0x-prefixed hexadecimal string.');
  if (!validateStacksAddress(input.user)) throw new RelayError(400, 'INVALID_USER', 'user must be a valid canonical Stacks address.');
  if (input.quoteId !== undefined && (typeof input.quoteId !== 'string' || !/^0x[0-9a-f]{64}$/.test(input.quoteId))) throw new RelayError(400, 'INVALID_QUOTE_ID', 'quoteId must be a 32-byte lowercase 0x-prefixed hex string.');
  return { transaction: input.transaction, user: input.user, quoteId: input.quoteId };
}

function parseQuoteRequest(input: unknown): QuoteIntent {
  if (!isRecord(input) || typeof input.origin !== 'string' || typeof input.recipient !== 'string' || typeof input.amountSats !== 'string' || typeof input.maxSponsorFeeSats !== 'string') {
    throw new RelayError(400, 'INVALID_REQUEST', 'Body must contain origin, recipient, amountSats, and maxSponsorFeeSats strings.');
  }
  if (!validateStacksAddress(input.origin)) throw new RelayError(400, 'INVALID_ORIGIN', 'origin must be a valid Stacks address.');
  if (!validateStacksAddress(input.recipient)) throw new RelayError(400, 'INVALID_RECIPIENT', 'recipient must be a valid Stacks address.');
  if (input.origin === input.recipient) throw new RelayError(422, 'INVALID_RECIPIENT', 'recipient must differ from origin.');
  const amountSats = parsePositiveDecimal(input.amountSats, 'amountSats');
  const maxSponsorFeeSats = parsePositiveDecimal(input.maxSponsorFeeSats, 'maxSponsorFeeSats');
  if (input.memo !== undefined && (typeof input.memo !== 'string' || !/^0x(?:[0-9a-f]{2}){0,34}$/.test(input.memo))) throw new RelayError(400, 'INVALID_MEMO', 'memo must be 0x-prefixed lowercase hex up to 34 bytes.');
  return { origin: input.origin, recipient: input.recipient, amountSats, maxSponsorFeeSats, memo: input.memo };
}

function parsePositiveDecimal(value: string, field: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) throw new RelayError(400, 'INVALID_INTEGER', `${field} must be a positive decimal string.`);
  return BigInt(value);
}

function parseHeartbeatRequest(input: unknown): { operatorId: string; stxBalanceMicroStx: string; recentSuccessfulTransactions?: string[] } {
  if (!isRecord(input) || typeof input.operator_id !== 'string' || typeof input.stx_balance_microstx !== 'string' || !/^\d+$/.test(input.stx_balance_microstx)) {
    throw new RelayError(400, 'INVALID_HEARTBEAT', 'Body must contain operator_id and a non-negative integer stx_balance_microstx.');
  }
  if (input.recent_successful_transactions !== undefined && (!Array.isArray(input.recent_successful_transactions) || input.recent_successful_transactions.some(txid => typeof txid !== 'string' || !/^[0-9a-f]{64}$/i.test(txid)))) {
    throw new RelayError(400, 'INVALID_HEARTBEAT', 'recent_successful_transactions must contain transaction IDs.');
  }
  return { operatorId: input.operator_id, stxBalanceMicroStx: input.stx_balance_microstx, recentSuccessfulTransactions: input.recent_successful_transactions as string[] | undefined };
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
  if (transaction.payload.payloadType === PayloadType.ContractCall) {
    const address = process.env.ADAPTER_CONTRACT_ADDRESS?.trim();
    const name = process.env.ADAPTER_CONTRACT_NAME?.trim() || 'sbtc-sponsored-transfer-v1';
    const payload = transaction.payload;
    if (address && addressToString(payload.contractAddress) === address && payload.contractName.content === name && payload.functionName.content === 'sponsored-transfer') return;
    throw new RelayError(422, 'UNSUPPORTED_TRANSACTION', 'Only the configured sBTC sponsored-transfer adapter may be sponsored.');
  }
  throw new RelayError(422, 'UNSUPPORTED_TRANSACTION', 'Only STX transfers and the configured sBTC sponsored-transfer adapter are supported.');
}

function validateTransactionAgainstQuote(transaction: ReturnType<typeof deserializeTransaction>, stored: StoredQuote): void {
  const payload = transaction.payload;
  if (payload.payloadType !== PayloadType.ContractCall) throw new RelayError(422, 'QUOTE_TRANSACTION_MISMATCH', 'Quoted sponsorship requires the sBTC adapter contract call.');
  const quote = stored.quote;
  if (`${addressToString(payload.contractAddress)}.${payload.contractName.content}` !== quote.adapterContract || payload.functionName.content !== quote.functionName) {
    throw new RelayError(422, 'QUOTE_TRANSACTION_MISMATCH', 'Transaction does not call the quoted adapter.');
  }
  const expectedArgs = [
    uintCV(stored.intent.amountSats),
    principalCV(stored.intent.recipient),
    uintCV(BigInt(quote.sponsorFee)),
    bufferCV(hexToBytes(quote.quoteId)),
    uintCV(BigInt(quote.expiresAtBlock)),
    stored.intent.memo === undefined ? noneCV() : someCV(bufferCV(hexToBytes(stored.intent.memo))),
  ];
  if (payload.functionArgs.length !== expectedArgs.length || payload.functionArgs.some((arg, index) => cvToString(arg) !== cvToString(expectedArgs[index]))) {
    throw new RelayError(422, 'QUOTE_TRANSACTION_MISMATCH', 'Transaction arguments do not match the quote.');
  }
  const recomputed = argumentsHash({
    ...stored.intent,
    quoteId: quote.quoteId,
    sponsorFee: BigInt(quote.sponsorFee),
    expiresAt: BigInt(quote.expiresAtBlock),
  });
  if (recomputed !== quote.argumentsHash) throw new RelayError(422, 'QUOTE_TRANSACTION_MISMATCH', 'Stored quote arguments hash is inconsistent.');
}

function argumentsHash(input: QuoteIntent & { quoteId: string; sponsorFee: bigint; expiresAt: bigint }): string {
  return `0x${hashStructuredData(tupleCV({
    amount: uintCV(input.amountSats),
    recipient: principalCV(input.recipient),
    'sponsor-fee': uintCV(input.sponsorFee),
    'quote-id': bufferCV(hexToBytes(input.quoteId)),
    'expiry-height': uintCV(input.expiresAt),
    memo: input.memo === undefined ? noneCV() : someCV(bufferCV(hexToBytes(input.memo))),
  }))}`;
}

function quoteDomainCV() {
  return tupleCV({ name: stringAsciiCV('ossr-quote'), version: stringAsciiCV('1'), 'chain-id': uintCV(2147483648n) });
}

function quoteMessageCV(quote: SbtcTransferQuote) {
  const [assetAddress, assetName] = splitContractPrincipal(quote.reimbursementAsset.contract);
  const [adapterAddress, adapterName] = splitContractPrincipal(quote.adapterContract);
  return tupleCV({
    'protocol-version': stringAsciiCV(quote.protocolVersion),
    'quote-id': bufferCV(hexToBytes(quote.quoteId)),
    'relay-id': stringAsciiCV(quote.relayId),
    network: stringAsciiCV(quote.network),
    sponsor: principalCV(quote.sponsorPrincipal),
    origin: principalCV(quote.origin),
    action: stringAsciiCV(quote.action),
    'reimbursement-asset': tupleCV({
      'asset-id': stringAsciiCV(quote.reimbursementAsset.assetId),
      contract: contractPrincipalCV(assetAddress, assetName),
      unit: stringAsciiCV(quote.reimbursementAsset.unit),
      decimals: uintCV(BigInt(quote.reimbursementAsset.decimals)),
    }),
    'adapter-contract': contractPrincipalCV(adapterAddress, adapterName),
    'function-name': stringAsciiCV(quote.functionName),
    'arguments-hash': bufferCV(hexToBytes(quote.argumentsHash)),
    'sponsor-fee': uintCV(BigInt(quote.sponsorFee)),
    'max-network-fee-microstx': uintCV(BigInt(quote.maxNetworkFeeMicroStx)),
    'issued-at-block': uintCV(BigInt(quote.issuedAtBlock)),
    'expires-at-block': uintCV(BigInt(quote.expiresAtBlock)),
    'policy-version': stringAsciiCV(quote.policyVersion),
    'key-id': stringAsciiCV(quote.keyId),
  });
}

function splitContractPrincipal(principal: string): [string, string] {
  const index = principal.lastIndexOf('.');
  if (index < 1 || index === principal.length - 1) throw new RelayError(500, 'INVALID_CONTRACT_CONFIG', `Invalid contract principal: ${principal}`);
  return [principal.slice(0, index), principal.slice(index + 1)];
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex.slice(2), 'hex'));
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

function respond(request: IncomingMessage, response: ServerResponse, status: number, body: object, allowedOrigins: string[]): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(request, allowedOrigins),
  });
  response.end(JSON.stringify(body));
}

function respondOptions(request: IncomingMessage, response: ServerResponse, allowedOrigins: string[]): void {
  response.writeHead(204, {
    'Cache-Control': 'no-store',
    ...corsHeaders(request, allowedOrigins),
  });
  response.end();
}

function corsHeaders(request: IncomingMessage, allowedOrigins: string[]): Record<string, string> {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept,X-Request-Id,Idempotency-Key',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function parseCorsOrigins(value: string | undefined): string[] {
  return (value ?? 'http://localhost:3000,http://127.0.0.1:3000,http://192.168.18.82:3000')
    .split(',')
    .map(origin => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
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
