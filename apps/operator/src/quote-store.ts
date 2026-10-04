import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { QuoteIntent, SponsorResponse, StoredQuote } from './api.js';

export type QuoteState = 'ISSUED' | 'PROCESSING' | 'BROADCAST';

export type QuoteRecord = StoredQuote & {
  state: QuoteState;
  requestHash?: string;
  result?: SponsorResponse;
  updatedAt: string;
};

export type QuoteReservation =
  | { kind: 'reserved'; record: QuoteRecord }
  | { kind: 'processing'; record: QuoteRecord }
  | { kind: 'completed'; record: QuoteRecord; result: SponsorResponse }
  | { kind: 'mismatch'; record: QuoteRecord };

export interface QuoteStore {
  list(): Promise<QuoteRecord[]>;
  putIssued(record: StoredQuote): Promise<void>;
  get(quoteId: string): Promise<QuoteRecord | undefined>;
  findByTransactionId(transactionId: string): Promise<QuoteRecord | undefined>;
  reserve(quoteId: string, requestHash: string): Promise<QuoteReservation | undefined>;
  release(quoteId: string, requestHash: string): Promise<void>;
  complete(quoteId: string, requestHash: string, result: SponsorResponse): Promise<void>;
}

export class MemoryQuoteStore implements QuoteStore {
  protected records = new Map<string, QuoteRecord>();
  private queue: Promise<void> = Promise.resolve();

  async list(): Promise<QuoteRecord[]> { return [...this.records.values()].map(record => clone(record)!); }

  async putIssued(record: StoredQuote): Promise<void> {
    await this.exclusive(async () => {
      this.records.set(record.quote.quoteId, { ...record, state: 'ISSUED', updatedAt: new Date().toISOString() });
      await this.persist();
    });
  }
  async get(quoteId: string): Promise<QuoteRecord | undefined> { return clone(this.records.get(quoteId)); }
  async findByTransactionId(transactionId: string): Promise<QuoteRecord | undefined> {
    return clone([...this.records.values()].find(record => record.result?.transaction_id === transactionId));
  }
  async reserve(quoteId: string, requestHash: string): Promise<QuoteReservation | undefined> {
    return this.exclusive(async () => {
      const record = this.records.get(quoteId);
      if (!record) return undefined;
      if (record.requestHash && record.requestHash !== requestHash) return { kind: 'mismatch', record: clone(record)! };
      if (record.state === 'BROADCAST' && record.result) return { kind: 'completed', record: clone(record)!, result: { ...record.result } };
      if (record.state === 'PROCESSING') return { kind: 'processing', record: clone(record)! };
      const reserved = { ...record, state: 'PROCESSING' as const, requestHash, updatedAt: new Date().toISOString() };
      this.records.set(quoteId, reserved);
      await this.persist();
      return { kind: 'reserved', record: clone(reserved)! };
    });
  }
  async release(quoteId: string, requestHash: string): Promise<void> {
    await this.exclusive(async () => {
      const record = this.records.get(quoteId);
      if (!record || record.state !== 'PROCESSING' || record.requestHash !== requestHash) return;
      this.records.set(quoteId, { ...record, state: 'ISSUED', requestHash: undefined, updatedAt: new Date().toISOString() });
      await this.persist();
    });
  }
  async complete(quoteId: string, requestHash: string, result: SponsorResponse): Promise<void> {
    await this.exclusive(async () => {
      const record = this.records.get(quoteId);
      if (!record || record.state !== 'PROCESSING' || record.requestHash !== requestHash) throw new Error('Quote reservation was lost before completion.');
      this.records.set(quoteId, { ...record, state: 'BROADCAST', result: { ...result }, updatedAt: new Date().toISOString() });
      await this.persist();
    });
  }
  protected async persist(): Promise<void> {}
  protected async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
}

type JsonQuoteRecord = Omit<QuoteRecord, 'intent'> & {
  intent: Omit<QuoteIntent, 'amountSats' | 'maxSponsorFeeSats'> & { amountSats: string; maxSponsorFeeSats: string };
};

export class JsonQuoteStore extends MemoryQuoteStore {
  private loaded = false;
  constructor(private readonly path: string) { super(); }

  override async list(): Promise<QuoteRecord[]> { await this.load(); return super.list(); }
  override async putIssued(record: StoredQuote): Promise<void> { await this.load(); await super.putIssued(record); }
  override async get(quoteId: string): Promise<QuoteRecord | undefined> { await this.load(); return super.get(quoteId); }
  override async findByTransactionId(transactionId: string): Promise<QuoteRecord | undefined> { await this.load(); return super.findByTransactionId(transactionId); }
  override async reserve(quoteId: string, requestHash: string): Promise<QuoteReservation | undefined> { await this.load(); return super.reserve(quoteId, requestHash); }
  override async release(quoteId: string, requestHash: string): Promise<void> { await this.load(); return super.release(quoteId, requestHash); }
  override async complete(quoteId: string, requestHash: string, result: SponsorResponse): Promise<void> { await this.load(); return super.complete(quoteId, requestHash, result); }

  protected override async persist(): Promise<void> {
    if (!this.loaded) return;
    const entries = [...this.records.values()].map(toJson);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
  }
  private async load(): Promise<void> {
    if (this.loaded) return;
    await this.exclusive(async () => {
      if (this.loaded) return;
      try {
        const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
        if (!Array.isArray(parsed)) throw new Error('Quote store must contain an array.');
        this.records = new Map(parsed.map(value => {
          const record = fromJson(value);
          return [record.quote.quoteId, record];
        }));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      this.loaded = true;
    });
  }
}

function toJson(record: QuoteRecord): JsonQuoteRecord {
  return { ...record, intent: { ...record.intent, amountSats: record.intent.amountSats.toString(), maxSponsorFeeSats: record.intent.maxSponsorFeeSats.toString() } };
}

function fromJson(value: unknown): QuoteRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Quote record must be an object.');
  const record = value as JsonQuoteRecord;
  if (!record.quote || !record.intent || !['ISSUED', 'PROCESSING', 'BROADCAST'].includes(record.state)) throw new Error('Quote record is incomplete.');
  if (!/^0x[0-9a-f]{64}$/.test(record.quote.quoteId) || !/^\d+$/.test(record.intent.amountSats) || !/^\d+$/.test(record.intent.maxSponsorFeeSats)) throw new Error('Quote record contains invalid identifiers or amounts.');
  return { ...record, intent: { ...record.intent, amountSats: BigInt(record.intent.amountSats), maxSponsorFeeSats: BigInt(record.intent.maxSponsorFeeSats) } };
}

function clone(record: QuoteRecord | undefined): QuoteRecord | undefined {
  return record ? { ...record, quote: { ...record.quote, reimbursementAsset: { ...record.quote.reimbursementAsset } }, intent: { ...record.intent }, result: record.result ? { ...record.result } : undefined } : undefined;
}
