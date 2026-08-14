import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateStacksAddress } from '@stacks/transactions';

/**
 * The deliberately small, chain-neutral operator record. Amounts are integer
 * base units so an on-chain registry can represent the same fields exactly.
 */
export type OperatorStatus = 'ONLINE' | 'OFFLINE';

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

export class OperatorRegistry implements OperatorRegistryReader {
  constructor(private readonly store: OperatorRegistryStore, private readonly now: () => Date = () => new Date()) {}

  async register(input: RegisterOperatorInput): Promise<OperatorRecord> {
    const existing = await this.store.get(input.operatorId);
    if (existing) throw new Error(`Operator ${input.operatorId} is already registered.`);
    const record = normaliseRecord({ ...input, lastSeen: input.lastSeen ?? this.now().toISOString() });
    await this.store.put(record);
    return record;
  }

  async update(operatorId: string, update: UpdateOperatorInput): Promise<OperatorRecord> {
    const current = await this.require(operatorId);
    const record = normaliseRecord({ ...current, ...update, operatorId, lastSeen: current.lastSeen });
    await this.store.put(record);
    return record;
  }

  async heartbeat(operatorId: string, status: OperatorStatus = 'ONLINE'): Promise<OperatorRecord> {
    const current = await this.require(operatorId);
    const record = { ...current, status, lastSeen: this.now().toISOString() };
    await this.store.put(record);
    return record;
  }

  async get(operatorId: string): Promise<OperatorRecord | undefined> { return this.store.get(operatorId); }

  async list(options: { status?: OperatorStatus } = {}): Promise<OperatorRecord[]> {
    const records = await this.store.list();
    return records
      .filter(record => !options.status || record.status === options.status)
      .sort((left, right) => left.operatorId.localeCompare(right.operatorId));
  }

  private async require(operatorId: string): Promise<OperatorRecord> {
    const record = await this.store.get(operatorId);
    if (!record) throw new Error(`Operator ${operatorId} is not registered.`);
    return record;
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
  if (record.status !== 'ONLINE' && record.status !== 'OFFLINE') throw new Error('status must be ONLINE or OFFLINE.');
  if (record.stxBalanceMicroStx < 0n) throw new Error('stx_balance_microstx must be non-negative.');
  if (!validateStacksAddress(record.reimbursementAddress)) throw new Error('reimbursement_address must be a valid Stacks address.');
  if (!Array.isArray(record.supportedTransactionTypes) || record.supportedTransactionTypes.length === 0 || record.supportedTransactionTypes.length > 32 || record.supportedTransactionTypes.some(type => !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(type))) throw new Error('supported_transaction_types must contain 1-32 valid type identifiers.');
  if (new Set(record.supportedTransactionTypes).size !== record.supportedTransactionTypes.length) throw new Error('supported_transaction_types must not contain duplicates.');
  if (!Number.isFinite(Date.parse(record.lastSeen))) throw new Error('last_seen must be an ISO-8601 timestamp.');
  if (record.sbtcBalanceSats !== undefined && record.sbtcBalanceSats < 0n) throw new Error('sbtc_balance_sats must be non-negative.');
  if (record.feeBps !== undefined && (!Number.isSafeInteger(record.feeBps) || record.feeBps < 0 || record.feeBps > 10_000)) throw new Error('fee_bps must be an integer from 0 to 10000.');
  return { ...record, endpoint: endpoint.toString(), supportedTransactionTypes: [...record.supportedTransactionTypes] };
}

function asAmount(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error(`${field} must be a non-negative integer string.`);
  return BigInt(value);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
