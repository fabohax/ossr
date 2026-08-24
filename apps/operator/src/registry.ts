import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateStacksAddress } from '@stacks/transactions';

/**
 * The deliberately small, chain-neutral operator record. Amounts are integer
 * base units so an on-chain registry can represent the same fields exactly.
 */
export type OperatorStatus = 'ONLINE' | 'OFFLINE' | 'UNHEALTHY';

export type OperatorOutcome = { successful: boolean; at: string; transactionId?: string };

export type OperatorHealth = {
  lastHeartbeat: string;
  recentSuccessfulTransactions: string[];
  failureRate: number;
};

export type OperatorRecord = {
  operatorId: string;
  publicKey: string;
  endpoint: string;
  status: OperatorStatus;
  /** Current observed balance in micro-STX, not a custody or collateral claim. */
  stxBalanceMicroStx: bigint;
  supportedTransactionTypes: string[];
  reimbursementAddress: string;
  lastSeen: string;
  /** Rolling, bounded health information maintained by the registry. */
  health?: OperatorHealth;
  outcomeHistory?: OperatorOutcome[];
  /** Optional presentation fields; quotes remain the source of truth for fees. */
  sbtcBalanceSats?: bigint;
  feeBps?: number;
};

/** JSON-safe representation returned by HTTP and stored by the MVP adapter. */
export type OperatorRegistryEntry = {
  operator_id: string;
  public_key: string;
  endpoint: string;
  status: OperatorStatus;
  stx_balance_microstx: string;
  supported_transaction_types: string[];
  reimbursement_address: string;
  last_seen: string;
  last_heartbeat?: string;
  recent_successful_transactions?: string[];
  failure_rate?: number;
  outcome_history?: OperatorOutcome[];
  sbtc_balance_sats?: string;
  fee_bps?: number;
};

/**
 * Storage boundary for the centralized MVP. An on-chain adapter can implement
 * this interface without changing discovery callers.
 */
export interface OperatorRegistryStore {
  list(): Promise<OperatorRecord[]>;
  get(operatorId: string): Promise<OperatorRecord | undefined>;
  put(record: OperatorRecord): Promise<void>;
}

/** Stable discovery surface for HTTP clients and a future on-chain adapter. */
export interface OperatorRegistryReader {
  list(options?: { status?: OperatorStatus }): Promise<OperatorRecord[]>;
  get(operatorId: string): Promise<OperatorRecord | undefined>;
}

export type RegisterOperatorInput = Omit<OperatorRecord, 'lastSeen'> & { lastSeen?: string };
export type UpdateOperatorInput = Partial<Omit<OperatorRecord, 'operatorId' | 'lastSeen'>>;

export type HeartbeatInput = {
  stxBalanceMicroStx: bigint;
  recentSuccessfulTransactions?: string[];
};

export type OperatorHealthPolicy = {
  minimumBalanceMicroStx?: bigint;
  heartbeatTimeoutMs?: number;
  maximumFailureRate?: number;
  outcomeWindowSize?: number;
};

export class OperatorRegistry implements OperatorRegistryReader {
  private readonly policy: Required<OperatorHealthPolicy>;

  constructor(private readonly store: OperatorRegistryStore, private readonly now: () => Date = () => new Date(), policy: OperatorHealthPolicy = {}) {
    this.policy = {
      minimumBalanceMicroStx: policy.minimumBalanceMicroStx ?? 1n,
      heartbeatTimeoutMs: policy.heartbeatTimeoutMs ?? 60_000,
      maximumFailureRate: policy.maximumFailureRate ?? 0.5,
      outcomeWindowSize: policy.outcomeWindowSize ?? 20,
    };
    if (this.policy.minimumBalanceMicroStx < 0n) throw new Error('minimumBalanceMicroStx must be non-negative.');
    if (!Number.isSafeInteger(this.policy.heartbeatTimeoutMs) || this.policy.heartbeatTimeoutMs < 1) throw new Error('heartbeatTimeoutMs must be a positive safe integer.');
    if (!Number.isFinite(this.policy.maximumFailureRate) || this.policy.maximumFailureRate < 0 || this.policy.maximumFailureRate > 1) throw new Error('maximumFailureRate must be between 0 and 1.');
    if (!Number.isSafeInteger(this.policy.outcomeWindowSize) || this.policy.outcomeWindowSize < 1) throw new Error('outcomeWindowSize must be a positive safe integer.');
  }

  async register(input: RegisterOperatorInput): Promise<OperatorRecord> {
    const existing = await this.store.get(input.operatorId);
    if (existing) throw new Error(`Operator ${input.operatorId} is already registered.`);
    const timestamp = input.lastSeen ?? this.now().toISOString();
    const record = normaliseRecord({ ...input, lastSeen: timestamp, health: input.health ?? emptyHealth(timestamp) });
    await this.store.put(record);
    return record;
  }

  async update(operatorId: string, update: UpdateOperatorInput): Promise<OperatorRecord> {
    const current = await this.require(operatorId);
    const record = normaliseRecord({ ...current, ...update, operatorId, lastSeen: current.lastSeen });
    await this.store.put(record);
    return record;
  }

  async heartbeat(operatorId: string, input?: HeartbeatInput): Promise<OperatorRecord> {
    const current = await this.require(operatorId);
    const timestamp = this.now().toISOString();
    const successful = input?.recentSuccessfulTransactions ?? current.health?.recentSuccessfulTransactions ?? [];
    const record = this.assess({ ...current, status: 'ONLINE', stxBalanceMicroStx: input?.stxBalanceMicroStx ?? current.stxBalanceMicroStx, lastSeen: timestamp,
      health: { lastHeartbeat: timestamp, recentSuccessfulTransactions: [...new Set(successful)].slice(-this.policy.outcomeWindowSize), failureRate: current.health?.failureRate ?? 0 } });
    await this.store.put(record);
    return record;
  }

  async recordSuccess(operatorId: string, transactionId: string): Promise<OperatorRecord> {
    if (!/^[0-9a-f]{64}$/i.test(transactionId)) throw new Error('transactionId must be a 64-character hexadecimal string.');
    return this.recordOutcome(operatorId, { successful: true, at: this.now().toISOString(), transactionId });
  }

  async recordFailure(operatorId: string): Promise<OperatorRecord> {
    return this.recordOutcome(operatorId, { successful: false, at: this.now().toISOString() });
  }

  async get(operatorId: string): Promise<OperatorRecord | undefined> {
    const record = await this.store.get(operatorId);
    if (!record) return undefined;
    const assessed = this.assess(record);
    if (assessed.status !== record.status) await this.store.put(assessed);
    return assessed;
  }

  async list(options: { status?: OperatorStatus } = {}): Promise<OperatorRecord[]> {
    const records = await Promise.all((await this.store.list()).map(async record => {
      const assessed = this.assess(record);
      if (assessed.status !== record.status) await this.store.put(assessed);
      return assessed;
    }));
    return records
      .filter(record => !options.status || record.status === options.status)
      .sort((left, right) => left.operatorId.localeCompare(right.operatorId));
  }

  private async require(operatorId: string): Promise<OperatorRecord> {
    const record = await this.store.get(operatorId);
    if (!record) throw new Error(`Operator ${operatorId} is not registered.`);
    return record;
  }

  private async recordOutcome(operatorId: string, outcome: OperatorOutcome): Promise<OperatorRecord> {
    const current = await this.require(operatorId);
    const history = this.outcomes(current);
    history.push(outcome);
    const successful = outcome.successful && outcome.transactionId
      ? [...(current.health?.recentSuccessfulTransactions ?? []), outcome.transactionId].slice(-this.policy.outcomeWindowSize)
      : current.health?.recentSuccessfulTransactions ?? [];
    const record = this.assess({ ...current, health: { ...(current.health ?? emptyHealth(current.lastSeen)), recentSuccessfulTransactions: successful, failureRate: failureRate(history) }, outcomeHistory: history.slice(-this.policy.outcomeWindowSize) });
    await this.store.put(record);
    return record;
  }

  private outcomes(record: OperatorRecord): OperatorOutcome[] { return record.outcomeHistory ?? []; }

  private assess(record: OperatorRecord): OperatorRecord {
    const health = record.health ?? emptyHealth(record.lastSeen);
    const unhealthy = record.status !== 'OFFLINE' && (
      record.stxBalanceMicroStx < this.policy.minimumBalanceMicroStx ||
      Date.parse(health.lastHeartbeat) + this.policy.heartbeatTimeoutMs < this.now().getTime() ||
      health.failureRate > this.policy.maximumFailureRate
    );
    return { ...record, status: unhealthy ? 'UNHEALTHY' : record.status === 'UNHEALTHY' ? 'ONLINE' : record.status,
      health: { ...health, failureRate: failureRate(this.outcomes(record)) } };
  }
}

/** Durable centralized MVP store. It uses replacement writes to avoid partial JSON files. */
export class JsonOperatorRegistryStore implements OperatorRegistryStore {
  constructor(private readonly path: string) {}

  async list(): Promise<OperatorRecord[]> { return (await this.read()).map(fromEntry); }
  async get(operatorId: string): Promise<OperatorRecord | undefined> {
    const entry = (await this.read()).find(value => value.operator_id === operatorId);
    return entry ? fromEntry(entry) : undefined;
  }
  async put(record: OperatorRecord): Promise<void> {
    const entries = await this.read();
    const entry = toEntry(record);
    const index = entries.findIndex(value => value.operator_id === entry.operator_id);
    if (index < 0) entries.push(entry); else entries[index] = entry;
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
    await rename(temporary, this.path);
  }
  private async read(): Promise<OperatorRegistryEntry[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('Registry file must contain an array.');
      return parsed.map(value => parseEntry(value));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}

export function toEntry(record: OperatorRecord): OperatorRegistryEntry {
  const normalised = normaliseRecord(record);
  return {
    operator_id: normalised.operatorId,
    public_key: normalised.publicKey,
    endpoint: normalised.endpoint,
    status: normalised.status,
    stx_balance_microstx: normalised.stxBalanceMicroStx.toString(),
    supported_transaction_types: normalised.supportedTransactionTypes,
    reimbursement_address: normalised.reimbursementAddress,
    last_seen: normalised.lastSeen,
    ...(normalised.health === undefined ? {} : {
      last_heartbeat: normalised.health.lastHeartbeat,
      recent_successful_transactions: normalised.health.recentSuccessfulTransactions,
      failure_rate: normalised.health.failureRate,
    }),
    ...(normalised.outcomeHistory === undefined ? {} : { outcome_history: normalised.outcomeHistory }),
    ...(normalised.sbtcBalanceSats === undefined ? {} : { sbtc_balance_sats: normalised.sbtcBalanceSats.toString() }),
    ...(normalised.feeBps === undefined ? {} : { fee_bps: normalised.feeBps }),
  };
}

export function fromEntry(entry: OperatorRegistryEntry): OperatorRecord {
  return normaliseRecord({
    operatorId: entry.operator_id, publicKey: entry.public_key, endpoint: entry.endpoint, status: entry.status,
    stxBalanceMicroStx: asAmount(entry.stx_balance_microstx, 'stx_balance_microstx'),
    supportedTransactionTypes: entry.supported_transaction_types, reimbursementAddress: entry.reimbursement_address,
    lastSeen: entry.last_seen,
    ...(entry.last_heartbeat === undefined ? {} : { health: {
      lastHeartbeat: entry.last_heartbeat,
      recentSuccessfulTransactions: entry.recent_successful_transactions ?? [],
      failureRate: entry.failure_rate ?? 0,
    } }),
    ...(entry.outcome_history === undefined ? {} : { outcomeHistory: entry.outcome_history }),
    ...(entry.sbtc_balance_sats === undefined ? {} : { sbtcBalanceSats: asAmount(entry.sbtc_balance_sats, 'sbtc_balance_sats') }),
    ...(entry.fee_bps === undefined ? {} : { feeBps: entry.fee_bps }),
  });
}

function parseEntry(value: unknown): OperatorRegistryEntry {
  if (!isRecord(value)) throw new Error('Registry entry must be an object.');
  return value as OperatorRegistryEntry;
}

function normaliseRecord(record: OperatorRecord): OperatorRecord {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(record.operatorId)) throw new Error('operator_id must be 1-64 URL-safe characters.');
  if (!/^0x[0-9a-fA-F]{66}$/.test(record.publicKey)) throw new Error('public_key must be a 33-byte 0x-prefixed public key.');
  let endpoint: URL;
  try { endpoint = new URL(record.endpoint); } catch { throw new Error('endpoint must be a valid HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('endpoint must be an HTTP(S) URL without credentials.');
  if (record.status !== 'ONLINE' && record.status !== 'OFFLINE' && record.status !== 'UNHEALTHY') throw new Error('status must be ONLINE, OFFLINE, or UNHEALTHY.');
  if (record.stxBalanceMicroStx < 0n) throw new Error('stx_balance_microstx must be non-negative.');
  if (!validateStacksAddress(record.reimbursementAddress)) throw new Error('reimbursement_address must be a valid Stacks address.');
  if (!Array.isArray(record.supportedTransactionTypes) || record.supportedTransactionTypes.length === 0 || record.supportedTransactionTypes.length > 32 || record.supportedTransactionTypes.some(type => !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(type))) throw new Error('supported_transaction_types must contain 1-32 valid type identifiers.');
  if (new Set(record.supportedTransactionTypes).size !== record.supportedTransactionTypes.length) throw new Error('supported_transaction_types must not contain duplicates.');
  if (!Number.isFinite(Date.parse(record.lastSeen))) throw new Error('last_seen must be an ISO-8601 timestamp.');
  if (record.health !== undefined) {
    if (!Number.isFinite(Date.parse(record.health.lastHeartbeat))) throw new Error('last_heartbeat must be an ISO-8601 timestamp.');
    if (!Array.isArray(record.health.recentSuccessfulTransactions) || record.health.recentSuccessfulTransactions.some(txid => !/^[0-9a-f]{64}$/i.test(txid))) throw new Error('recent_successful_transactions must contain transaction IDs.');
    if (!Number.isFinite(record.health.failureRate) || record.health.failureRate < 0 || record.health.failureRate > 1) throw new Error('failure_rate must be between 0 and 1.');
  }
  if (record.outcomeHistory !== undefined && (!Array.isArray(record.outcomeHistory) || record.outcomeHistory.some(outcome => !isOutcome(outcome)))) throw new Error('outcome_history contains an invalid outcome.');
  if (record.sbtcBalanceSats !== undefined && record.sbtcBalanceSats < 0n) throw new Error('sbtc_balance_sats must be non-negative.');
  if (record.feeBps !== undefined && (!Number.isSafeInteger(record.feeBps) || record.feeBps < 0 || record.feeBps > 10_000)) throw new Error('fee_bps must be an integer from 0 to 10000.');
  return { ...record, endpoint: endpoint.toString(), supportedTransactionTypes: [...record.supportedTransactionTypes],
    ...(record.health === undefined ? {} : { health: { ...record.health, recentSuccessfulTransactions: [...record.health.recentSuccessfulTransactions] } }),
    ...(record.outcomeHistory === undefined ? {} : { outcomeHistory: record.outcomeHistory.map(outcome => ({ ...outcome })) }),
  };
}

function emptyHealth(timestamp: string): OperatorHealth { return { lastHeartbeat: timestamp, recentSuccessfulTransactions: [], failureRate: 0 }; }
function failureRate(outcomes: OperatorOutcome[]): number { return outcomes.length === 0 ? 0 : outcomes.filter(outcome => !outcome.successful).length / outcomes.length; }
function isOutcome(value: unknown): value is OperatorOutcome {
  return isRecord(value) && typeof value.successful === 'boolean' && typeof value.at === 'string' && Number.isFinite(Date.parse(value.at)) &&
    (value.transactionId === undefined || typeof value.transactionId === 'string' && /^[0-9a-f]{64}$/i.test(value.transactionId));
}

function asAmount(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error(`${field} must be a non-negative integer string.`);
  return BigInt(value);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
