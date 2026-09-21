import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import {
  AddressHashMode,
  AddressVersion,
  AuthType,
  bufferCV,
  contractPrincipalCV,
  cvToString,
  FungibleConditionCode,
  PayloadType,
  PostConditionMode,
  PostConditionPrincipalId,
  PostConditionType,
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
import { MemoryQuoteStore, type QuoteStore } from './quote-store.js';

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
  /** Operator's estimated all-in cost. Quotes never charge less than this floor. */
  breakEvenFeeSats?: bigint;
  /** Enables a quote-time floor derived from live network fees and STX/BTC prices. */
  dynamicPricing?: boolean;
  estimatedTransactionBytes?: bigint;
  infrastructureCostSats?: bigint;
  riskReserveSats?: bigint;
  minimumProfitSats?: bigint;
  pricingApiUrl?: string;
  pricingCacheMs?: number;
  /** Transfer-size divisor used by the default logarithmic fee curve. */
  pricingScaleSats?: bigint;
  /** Sats charged for each doubling on the default logarithmic fee curve. */
  pricingGrowthSats?: bigint;
  /** Optional fixed-fee override for operators that do not use the curve. */
  sponsorFeeSats?: bigint;
  corsAllowedOrigins?: string[];
  /** Stacks Core RPC base URL exposing authenticated /v3 transaction simulation. */
  simulationApiUrl?: string;
  simulationAuthToken?: string;
  simulationTimeoutMs?: number;
  /** Test seam; production uses the Stacks Core simulation RPC. */
  simulateTransaction?: (transaction: Uint8Array, txid: string, minimumBlockHeight: number) => Promise<void>;
  quoteStore?: QuoteStore;
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

export type StoredQuote = {
  quote: SbtcTransferQuote & { signature: string };
  intent: QuoteIntent;
  consumedBy?: string;
};

export type QuoteIntent = {
  origin: string;
  recipient: string;
  amountSats: bigint;
  maxSponsorFeeSats: bigint;
  memo?: string;
};

export type OperatorMetricsSnapshot = {
  generatedAt: string;
  startedAt: string;
  uptimeSeconds: number;
  operator: Awaited<ReturnType<OssrOperator['health']>>;
  requests: { total: number; info: number; metrics: number; quotes: number; sponsorships: number; status: number; other: number };
  sponsorships: { rejections: number; broadcasts: number; confirmations: number };
  latencyMs: {
    quote: LatencySnapshot;
    submissionToBroadcast: LatencySnapshot;
    broadcastToConfirmation: LatencySnapshot;
  };
  costs: { stxPaidMicroStx: string; satsReimbursed: string };
};

export type LatencySnapshot = { count: number; total: number; average: number | null; last: number | null; max: number | null };

type LatencyAccumulator = { count: number; total: number; last: number | null; max: number | null };

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
  private readonly simulationApiUrl: string;
  private readonly simulationTimeoutMs: number;
  private readonly quoteStore: QuoteStore;
  private readonly startedAt = new Date();
  private readonly counters = {
    requests: { total: 0, info: 0, metrics: 0, quotes: 0, sponsorships: 0, status: 0, other: 0 },
    rejections: 0,
    broadcasts: 0,
    confirmations: 0,
    stxPaidMicroStx: 0n,
    satsReimbursed: 0n,
    latencyMs: {
      quote: { count: 0, total: 0, last: null, max: null } as LatencyAccumulator,
      submissionToBroadcast: { count: 0, total: 0, last: null, max: null } as LatencyAccumulator,
      broadcastToConfirmation: { count: 0, total: 0, last: null, max: null } as LatencyAccumulator,
    },
  };
  private readonly confirmedTransactions = new Set<string>();
  private readonly broadcasts = new Map<string, { at: number; reimbursementSats: bigint }>();
  private pricingCache?: { expiresAt: number; floorSats: bigint; networkFeeMicroStx: bigint; networkCostSats: bigint };

  constructor(private readonly config: RelayApiConfig) {
    this.stacksApiUrl = (config.stacksApiUrl ?? 'https://api.testnet.hiro.so').replace(/\/$/, '');
    this.maximumFeeMicroStx = config.maximumFeeMicroStx ?? 100_000n;
    this.healthPollIntervalMs = config.healthPollIntervalMs ?? 10_000;
    if (!Number.isSafeInteger(this.healthPollIntervalMs) || this.healthPollIntervalMs < 1) throw new Error('healthPollIntervalMs must be a positive safe integer.');
    this.log = config.logger ?? (() => undefined);
    this.corsAllowedOrigins = config.corsAllowedOrigins ?? parseCorsOrigins(process.env.OSSR_CORS_ALLOWED_ORIGINS);
    this.simulationApiUrl = (config.simulationApiUrl ?? this.stacksApiUrl).replace(/\/$/, '');
    this.simulationTimeoutMs = config.simulationTimeoutMs ?? 15_000;
    if (!Number.isSafeInteger(this.simulationTimeoutMs) || this.simulationTimeoutMs < 1) throw new Error('simulationTimeoutMs must be a positive safe integer.');
    this.quoteStore = config.quoteStore ?? new MemoryQuoteStore();
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
    const submittedAt = Date.now();
    this.log('relay.transaction_state', { status: 'REQUESTED' });
    const { transaction: encoded, user, quoteId } = parseSponsorRequest(input);
    if (!quoteId) throw new RelayError(400, 'QUOTE_REQUIRED', 'A relay-issued quoteId is required for sponsorship.');
    const quote = await this.requireUsableQuote(quoteId, user);
    const transaction = deserializeOriginTransaction(encoded, user);
    this.config.validateTransaction?.(transaction);
    defaultTransactionPolicy(transaction, quote.quote.adapterContract);
    validateTransactionAgainstQuote(transaction, quote);
    this.log('relay.transaction_state', { status: 'ACCEPTED' });

    const health = await this.config.operator.health();
    if (!health.healthy) throw new RelayError(503, 'OPERATOR_UNAVAILABLE', health.reason ?? 'Operator is unavailable.');

    const feeMicroStx = await this.estimateFee(transaction);
    if (feeMicroStx <= 0n || feeMicroStx > this.maximumFeeMicroStx) {
      throw new RelayError(422, 'FEE_OUT_OF_POLICY', 'Estimated network fee is outside relay policy.');
    }

    const requestHash = transactionHash(encoded);
    const minimumSimulationBlockHeight = Number(await this.currentStacksHeight()) + 1;
    const reservation = await this.quoteStore.reserve(quoteId, requestHash);
    if (!reservation) throw new RelayError(404, 'QUOTE_NOT_FOUND', 'Quote was not issued by this relay.');
    if (reservation.kind === 'mismatch') throw new RelayError(409, 'IDEMPOTENCY_MISMATCH', 'Quote was already submitted with different transaction bytes.');
    if (reservation.kind === 'processing') throw new RelayError(409, 'SPONSORSHIP_IN_PROGRESS', 'This quote is already being processed; retry after reconciliation.');
    if (reservation.kind === 'completed') return reservation.result;

    let sponsored: Awaited<ReturnType<OssrOperator['sponsor']>>;
    let broadcast: Awaited<ReturnType<OssrOperator['broadcast']>>;
    let simulationPassed = false;
    try {
      const result = await this.config.operator.sponsorAndBroadcast(encoded, feeMicroStx, async signed => {
        await this.simulate(signed.transaction, signed.txid, minimumSimulationBlockHeight);
        simulationPassed = true;
        this.log('relay.transaction_state', { status: 'SIMULATED', transactionId: signed.txid });
      });
      sponsored = result.signed;
      this.log('relay.transaction_state', { status: 'SPONSORED', transactionId: sponsored.txid });
      broadcast = result.broadcast;
    } catch (error) {
      if (!simulationPassed) await this.quoteStore.release(quoteId, requestHash);
      await this.recordFailure();
      throw error;
    }
    const sponsorshipId = broadcast.txid;
    const result = { status: 'BROADCAST' as const, operator: this.config.operator.address, transaction_id: broadcast.txid, fee_microstx: feeMicroStx.toString(), sponsorship_id: this.config.reimbursementService ? sponsorshipId : undefined };
    const broadcastAt = Date.now();
    this.counters.broadcasts += 1;
    this.counters.stxPaidMicroStx += feeMicroStx;
    recordLatency(this.counters.latencyMs.submissionToBroadcast, broadcastAt - submittedAt);
    this.broadcasts.set(broadcast.txid.toLowerCase(), { at: broadcastAt, reimbursementSats: BigInt(quote.quote.sponsorFee) });
    await this.quoteStore.complete(quoteId, requestHash, result);
    await this.recordSuccess(broadcast.txid);
    if (this.config.reimbursementService) {
      await this.config.reimbursementService.create({ sponsorshipId, stacksTxId: broadcast.txid, feePaidMicroStx: feeMicroStx });
    }
    this.log('relay.transaction_state', { status: 'BROADCAST', transactionId: broadcast.txid });
    return result;
  }

  async info(): Promise<object> {
    const adapterContract = this.adapterContract();
    const sbtcContract = this.sbtcContract();
    const dynamicPricing = this.config.dynamicPricing ? await this.dynamicCostFloor() : undefined;
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
        sponsorFeeSats: this.config.sponsorFeeSats?.toString(),
        pricingModel: this.config.sponsorFeeSats === undefined ? 'log2' : 'fixed',
        pricingScaleSats: this.config.sponsorFeeSats === undefined ? this.pricingScaleSats().toString() : undefined,
        pricingGrowthSats: this.config.sponsorFeeSats === undefined ? this.pricingGrowthSats().toString() : undefined,
        minimumSponsorFeeSats: '1',
        breakEvenFeeSats: (dynamicPricing?.floorSats ?? this.breakEvenFeeSats()).toString(),
        pricingPolicy: this.config.dynamicPricing
          ? 'max(fixed-or-log2,network-cost+infrastructure+risk+minimum-profit,1)'
          : 'max(fixed-or-log2,break-even,1)',
        dynamicPricing: this.config.dynamicPricing ?? false,
        estimatedNetworkFeeMicroStx: dynamicPricing?.networkFeeMicroStx.toString(),
        estimatedNetworkCostSats: dynamicPricing?.networkCostSats.toString(),
        infrastructureCostSats: (this.config.infrastructureCostSats ?? 0n).toString(),
        riskReserveSats: (this.config.riskReserveSats ?? 0n).toString(),
        minimumProfitSats: (this.config.minimumProfitSats ?? 1n).toString(),
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

  async metricsSnapshot(): Promise<OperatorMetricsSnapshot> {
    return {
      generatedAt: new Date().toISOString(),
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - this.startedAt.getTime()) / 1_000)),
      operator: await this.config.operator.health(),
      requests: { ...this.counters.requests },
      sponsorships: {
        rejections: this.counters.rejections,
        broadcasts: this.counters.broadcasts,
        confirmations: this.counters.confirmations,
      },
      latencyMs: {
        quote: latencySnapshot(this.counters.latencyMs.quote),
        submissionToBroadcast: latencySnapshot(this.counters.latencyMs.submissionToBroadcast),
        broadcastToConfirmation: latencySnapshot(this.counters.latencyMs.broadcastToConfirmation),
      },
      costs: {
        stxPaidMicroStx: this.counters.stxPaidMicroStx.toString(),
        satsReimbursed: this.counters.satsReimbursed.toString(),
      },
    };
  }

  async quote(input: unknown): Promise<QuoteResponse> {
    const startedAt = Date.now();
    if (!this.config.quotePrivateKey) throw new RelayError(503, 'QUOTES_DISABLED', 'QUOTE_PRIVATE_KEY is not configured.');
    const intent = parseQuoteRequest(input);
    const adapterContract = this.adapterContract();
    const sbtcContract = this.sbtcContract();
    if (!adapterContract || !sbtcContract) throw new RelayError(503, 'QUOTE_POLICY_INCOMPLETE', 'Adapter and sBTC contract configuration are required.');
    const sponsorFee = await this.sponsorFeeSats(intent.amountSats);
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
    await this.quoteStore.putIssued({ quote, intent });
    recordLatency(this.counters.latencyMs.quote, Date.now() - startedAt);
    return { quote, quotePublicKey: this.quotePublicKey() };
  }

  private async estimateFee(transaction: ReturnType<typeof deserializeTransaction>): Promise<bigint> {
    const response = await fetch(`${this.stacksApiUrl}/v2/fees/transfer`, { headers: { Accept: 'text/plain' } });
    if (!response.ok) throw new RelayError(503, 'FEE_UNAVAILABLE', `Fee estimator returned HTTP ${response.status}.`);
    const rate = (await response.text()).trim();
    if (!/^[0-9]+$/.test(rate)) throw new RelayError(503, 'FEE_UNAVAILABLE', 'Fee estimator returned an invalid rate.');
    return BigInt(rate) * BigInt(estimateTransactionByteLength(transaction));
  }

  private async simulate(transaction: Uint8Array, expectedTxid: string, minimumBlockHeight: number): Promise<void> {
    if (this.config.simulateTransaction) {
      await this.config.simulateTransaction(transaction, expectedTxid, minimumBlockHeight);
      return;
    }
    let response: Response;
    try {
      response = await fetch(`${this.simulationApiUrl}/v3/transactions/simulate`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(this.config.simulationAuthToken ? { authorization: this.config.simulationAuthToken } : {}),
        },
        body: JSON.stringify({ transaction_hex: Buffer.from(transaction).toString('hex') }),
        signal: AbortSignal.timeout(this.simulationTimeoutMs),
      });
    } catch (error) {
      throw new RelayError(503, 'SIMULATION_UNAVAILABLE', `Transaction simulation request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      throw new RelayError(503, 'SIMULATION_UNAVAILABLE', `Transaction simulation returned HTTP ${response.status}.`);
    }
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new RelayError(503, 'SIMULATION_INVALID_RESPONSE', 'Transaction simulation returned invalid JSON.'); }
    validateSimulationResponse(body, expectedTxid, minimumBlockHeight);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'OPTIONS') {
      respondOptions(request, response, this.corsAllowedOrigins);
      return;
    }
    this.recordRequest(request);
    if (request.method === 'GET' && request.url === '/v1/info') {
      respond(request, response, 200, await this.info(), this.corsAllowedOrigins);
      return;
    }
    if (request.method === 'GET' && request.url === '/v1/metrics') {
      respond(request, response, 200, await this.metricsSnapshot(), this.corsAllowedOrigins);
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
        const transactionId = sponsorshipMatch[1].toLowerCase();
        if (status.status === 'success' && !this.confirmedTransactions.has(transactionId)) {
          this.confirmedTransactions.add(transactionId);
          this.counters.confirmations += 1;
          const lifecycle = this.broadcasts.get(transactionId);
          if (lifecycle) {
            recordLatency(this.counters.latencyMs.broadcastToConfirmation, Date.now() - lifecycle.at);
            this.counters.satsReimbursed += lifecycle.reimbursementSats;
          }
        }
        const stored = await this.quoteStore.findByTransactionId(sponsorshipMatch[1]);
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
      this.counters.rejections += 1;
      const relayError = toRelayError(error);
      this.log('relay.sponsor.rejected', { code: relayError.code, message: relayError.message });
      respond(request, response, relayError.status, { error: relayError.code, message: relayError.message }, this.corsAllowedOrigins);
    }
  }

  private recordRequest(request: IncomingMessage): void {
    let kind: keyof Omit<typeof this.counters.requests, 'total'> = 'other';
    if (request.method === 'GET' && request.url === '/v1/info') kind = 'info';
    else if (request.method === 'GET' && request.url === '/v1/metrics') kind = 'metrics';
    else if (request.method === 'POST' && request.url === '/v1/quotes') kind = 'quotes';
    else if (request.method === 'POST' && (request.url === '/v1/sponsor' || request.url === '/v1/sponsorships')) kind = 'sponsorships';
    else if (request.method === 'GET' && /^\/v1\/sponsorships\/0x[0-9a-f]{64}$/i.test(request.url ?? '')) kind = 'status';
    this.counters.requests.total += 1;
    this.counters.requests[kind] += 1;
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

  private async sponsorFeeSats(amountSats: bigint): Promise<bigint> {
    const configured = this.config.sponsorFeeSats;
    const requestedFee = configured ?? this.pricingGrowthSats() * ceilLog2(1n + ceilDiv(amountSats, this.pricingScaleSats()));
    const costFloor = this.config.dynamicPricing
      ? (await this.dynamicCostFloor()).floorSats
      : this.breakEvenFeeSats();
    // A quote cannot underpay the operator: the signed fee covers at least the
    // configured all-in cost, even for transfers smaller than that cost.
    return maxBigInt(1n, requestedFee, costFloor);
  }

  private pricingScaleSats(): bigint {
    const value = this.config.pricingScaleSats ?? 100n;
    if (value < 1n) throw new RelayError(503, 'PRICING_POLICY_INVALID', 'Logarithmic pricing scale must be positive.');
    return value;
  }

  private pricingGrowthSats(): bigint {
    const value = this.config.pricingGrowthSats ?? 2n;
    if (value < 1n) throw new RelayError(503, 'PRICING_POLICY_INVALID', 'Logarithmic pricing growth must be positive.');
    return value;
  }

  private async dynamicCostFloor(): Promise<{ floorSats: bigint; networkFeeMicroStx: bigint; networkCostSats: bigint }> {
    if (this.pricingCache && this.pricingCache.expiresAt > Date.now()) return this.pricingCache;
    const estimatedBytes = this.config.estimatedTransactionBytes ?? 600n;
    const infrastructure = this.config.infrastructureCostSats ?? 0n;
    const riskReserve = this.config.riskReserveSats ?? 0n;
    const minimumProfit = this.config.minimumProfitSats ?? 1n;
    if (estimatedBytes <= 0n || infrastructure < 0n || riskReserve < 0n || minimumProfit < 1n) {
      throw new RelayError(503, 'PRICING_POLICY_INVALID', 'Dynamic pricing inputs are invalid.');
    }
    try {
      const [feeResponse, priceResponse] = await Promise.all([
        fetch(`${this.stacksApiUrl}/v2/fees/transfer`, { headers: { Accept: 'text/plain' } }),
        fetch(this.config.pricingApiUrl ?? 'https://api.coingecko.com/api/v3/simple/price?ids=blockstack,bitcoin&vs_currencies=usd', { headers: { Accept: 'application/json' } }),
      ]);
      if (!feeResponse.ok || !priceResponse.ok) throw new Error(`pricing dependency returned HTTP ${!feeResponse.ok ? feeResponse.status : priceResponse.status}`);
      const feeRateText = (await feeResponse.text()).trim();
      if (!/^[0-9]+$/.test(feeRateText) || BigInt(feeRateText) < 1n) throw new Error('invalid network fee rate');
      const prices = await priceResponse.json() as { blockstack?: { usd?: unknown }; bitcoin?: { usd?: unknown } };
      const stxUsd = positivePriceScale(prices.blockstack?.usd, 'STX');
      const btcUsd = positivePriceScale(prices.bitcoin?.usd, 'BTC');
      const networkFeeMicroStx = BigInt(feeRateText) * estimatedBytes;
      const networkCostSats = ceilDiv(networkFeeMicroStx * stxUsd * 100_000_000n, 1_000_000n * btcUsd);
      const floorSats = networkCostSats + infrastructure + riskReserve + minimumProfit;
      const result = { floorSats, networkFeeMicroStx, networkCostSats, expiresAt: Date.now() + (this.config.pricingCacheMs ?? 60_000) };
      this.pricingCache = result;
      return result;
    } catch (error) {
      throw new RelayError(503, 'PRICING_UNAVAILABLE', `Cannot calculate a safe sponsor fee: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private breakEvenFeeSats(): bigint {
    const fee = this.config.breakEvenFeeSats ?? 1n;
    if (fee < 0n) throw new Error('breakEvenFeeSats must not be negative.');
    return fee;
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

  private async requireUsableQuote(quoteId: string, origin: string): Promise<StoredQuote> {
    const stored = await this.quoteStore.get(quoteId);
    if (!stored) throw new RelayError(404, 'QUOTE_NOT_FOUND', 'Quote was not issued by this relay.');
    if (stored.state === 'BROADCAST' && stored.result) return stored;
    if (stored.quote.origin !== origin) throw new RelayError(422, 'QUOTE_ORIGIN_MISMATCH', 'Quote origin does not match submitted user.');
    const height = await this.currentStacksHeight();
    if (height > BigInt(stored.quote.expiresAtBlock)) throw new RelayError(422, 'QUOTE_EXPIRED', 'Quote has expired.');
    return stored;
  }
}

function transactionHash(encoded: string): string {
  return createHash('sha256').update(Buffer.from(encoded.slice(2), 'hex')).digest('hex');
}

function maxBigInt(...values: bigint[]): bigint {
  return values.reduce((maximum, value) => value > maximum ? value : maximum);
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function ceilLog2(value: bigint): bigint {
  if (value <= 1n) return 0n;
  let exponent = 0n;
  let power = 1n;
  while (power < value) {
    power <<= 1n;
    exponent += 1n;
  }
  return exponent;
}

function positivePriceScale(value: unknown, symbol: string): bigint {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`invalid ${symbol}/USD price`);
  // Eight decimal places are enough for quote pricing. STX rounds upward and
  // BTC rounding error is negligible at this scale; the final division rounds up.
  return BigInt(Math.max(1, Math.round(value * 100_000_000)));
}

export function validateSimulationResponse(body: unknown, expectedTxid: string, minimumBlockHeight: number): void {
  if (!isRecord(body)
    || typeof body.txid !== 'string' || !/^(?:0x)?[0-9a-f]{64}$/i.test(body.txid)
    || typeof body.tip_block_id !== 'string' || !/^(?:0x)?[0-9a-f]{64}$/i.test(body.tip_block_id)
    || typeof body.consensus_hash !== 'string' || !/^(?:0x)?[0-9a-f]{40}$/i.test(body.consensus_hash)
    || typeof body.block_height !== 'number' || !Number.isSafeInteger(body.block_height) || body.block_height < 1
    || typeof body.result_hex !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(body.result_hex)
    || typeof body.stx_burned !== 'number' || !Number.isSafeInteger(body.stx_burned) || body.stx_burned < 0
    || !isRecord(body.execution_cost) || !isRecord(body.execution_limit)
    || !Array.isArray(body.events)
    || typeof body.post_condition_aborted !== 'boolean'
    || !('vm_error' in body) || (body.vm_error !== null && typeof body.vm_error !== 'string')) {
    throw new RelayError(503, 'SIMULATION_INVALID_RESPONSE', 'Transaction simulation response is incomplete or malformed.');
  }
  const txid = body.txid.replace(/^0x/, '').toLowerCase();
  if (txid !== expectedTxid.replace(/^0x/, '').toLowerCase()) {
    throw new RelayError(503, 'SIMULATION_INVALID_RESPONSE', 'Transaction simulation returned a mismatched transaction ID.');
  }
  if (body.block_height < minimumBlockHeight) {
    throw new RelayError(503, 'SIMULATION_STALE', `Transaction simulation used block height ${body.block_height}, below required height ${minimumBlockHeight}.`);
  }
  if (body.post_condition_aborted || body.vm_error !== null || body.result_hex.toLowerCase() !== '0x0703') {
    throw new RelayError(422, 'SIMULATION_FAILED', 'Transaction simulation did not return (ok true).');
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

function defaultTransactionPolicy(transaction: ReturnType<typeof deserializeTransaction>, adapterContract: string): void {
  if (transaction.payload.payloadType === PayloadType.ContractCall) {
    const payload = transaction.payload;
    if (`${addressToString(payload.contractAddress)}.${payload.contractName.content}` === adapterContract && payload.functionName.content === 'sponsored-transfer') return;
    throw new RelayError(422, 'UNSUPPORTED_TRANSACTION', 'Only the configured sBTC sponsored-transfer adapter may be sponsored.');
  }
  throw new RelayError(422, 'UNSUPPORTED_TRANSACTION', 'Only the configured sBTC sponsored-transfer adapter may be sponsored.');
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
  validatePostConditions(transaction, stored);
}

function validatePostConditions(transaction: ReturnType<typeof deserializeTransaction>, stored: StoredQuote): void {
  if (transaction.postConditionMode !== PostConditionMode.Deny) {
    throw new RelayError(422, 'INVALID_POST_CONDITIONS', 'Post-condition mode must deny unspecified asset transfers.');
  }
  const conditions = transaction.postConditions.values;
  if (conditions.length !== 1) {
    throw new RelayError(422, 'INVALID_POST_CONDITIONS', 'Exactly one sBTC fungible-token post-condition is required.');
  }
  const condition = conditions[0];
  if (condition.conditionType !== PostConditionType.Fungible || condition.conditionCode !== FungibleConditionCode.Equal) {
    throw new RelayError(422, 'INVALID_POST_CONDITIONS', 'The post-condition must require an exact fungible-token outflow.');
  }
  if (condition.principal.prefix !== PostConditionPrincipalId.Standard || addressToString(condition.principal.address) !== stored.quote.origin) {
    throw new RelayError(422, 'INVALID_POST_CONDITIONS', 'The post-condition principal must be the quote origin.');
  }
  const [assetAddress, assetContractName] = splitContractPrincipal(stored.quote.reimbursementAsset.contract);
  if (addressToString(condition.asset.address) !== assetAddress || condition.asset.contractName.content !== assetContractName || condition.asset.assetName.content !== 'sbtc-token') {
    throw new RelayError(422, 'INVALID_POST_CONDITIONS', 'The post-condition must reference the configured sBTC asset.');
  }
  const exactOutflow = stored.intent.amountSats + BigInt(stored.quote.sponsorFee);
  if (condition.amount !== exactOutflow) {
    throw new RelayError(422, 'INVALID_POST_CONDITIONS', 'The post-condition must equal the transfer amount plus sponsor fee.');
  }
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

function recordLatency(accumulator: LatencyAccumulator, milliseconds: number): void {
  const duration = Math.max(0, Math.round(milliseconds));
  accumulator.count += 1;
  accumulator.total += duration;
  accumulator.last = duration;
  accumulator.max = accumulator.max === null ? duration : Math.max(accumulator.max, duration);
}

function latencySnapshot(accumulator: LatencyAccumulator): LatencySnapshot {
  return {
    count: accumulator.count,
    total: accumulator.total,
    average: accumulator.count === 0 ? null : accumulator.total / accumulator.count,
    last: accumulator.last,
    max: accumulator.max,
  };
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
