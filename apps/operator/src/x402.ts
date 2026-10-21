import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export type PaymentRequirements = {
  scheme: 'exact'; network: string; amount: string; asset: string; payTo: string;
  maxTimeoutSeconds: number; extra?: Record<string, unknown>;
};
export type X402Config = {
  facilitatorUrl: string;
  resourceUrl: string;
  requirements: PaymentRequirements;
  timeoutMs?: number;
  /** Durable payment bindings; run one relay process per store. */
  storePath?: string;
};
export class X402Error extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export const encodePayment = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64');
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The facilitator owns signature validation and on-chain nonce/replay protection. */
export class X402Payments {
  private readonly receipts = new Map<string, { binding: string; receipt: Record<string, unknown> }>();
  private readonly bindings = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  private loaded = false;
  private readonly config: X402Config;
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      try {
        if (!this.loaded && this.config.storePath) {
          try {
            const saved = JSON.parse(await readFile(this.config.storePath, 'utf8'));
            for (const [key, binding] of saved.bindings) this.bindings.set(key, binding);
            for (const [key, receipt] of saved.receipts) this.receipts.set(key, receipt);
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        this.loaded = true;
        return await work();
      } catch (error) {
        if (error instanceof X402Error) throw error;
        throw new X402Error(503, 'PAYMENT_STORE_UNAVAILABLE');
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async persist(): Promise<void> {
    if (!this.config.storePath) return;
    await mkdir(dirname(this.config.storePath), { recursive: true });
    const temp = `${this.config.storePath}.tmp`;
    await writeFile(temp, JSON.stringify({ bindings: [...this.bindings], receipts: [...this.receipts] }), { mode: 0o600 });
    await rename(temp, this.config.storePath);
  }
  constructor(config: X402Config) {
    this.config = JSON.parse(JSON.stringify(config));
    for (const url of [config.facilitatorUrl, config.resourceUrl]) {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid x402 URL.');
    }
    const r = config.requirements;
    if (r.scheme !== 'exact' || !/^[a-z0-9-]{3,8}:[A-Za-z0-9_-]{1,32}$/.test(r.network) || !/^[1-9][0-9]*$/.test(r.amount) || !r.asset || !r.payTo || !Number.isSafeInteger(r.maxTimeoutSeconds) || r.maxTimeoutSeconds < 1 || !Number.isSafeInteger(config.timeoutMs ?? 15000) || (config.timeoutMs ?? 15000) < 1) throw new Error('Invalid x402 payment requirements.');
  }
  required(error = 'PAYMENT-SIGNATURE header is required'): object {
    return { x402Version: 2, error, resource: { url: this.config.resourceUrl, description: 'Stacks transaction sponsorship', mimeType: 'application/json' }, accepts: [this.config.requirements] };
  }
  async authorize(header: string | string[] | undefined, input: unknown): Promise<(() => Promise<Record<string, unknown>>) & { receipt?: Record<string, unknown> }> {
    let payment: Record<string, unknown>;
    try {
      if (typeof header !== 'string' || header.length > 16384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(header)) throw new Error();
      const decoded: unknown = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
      if (!record(decoded) || decoded.x402Version !== 2 || !record(decoded.payload) || !isDeepStrictEqual(decoded.accepted, this.config.requirements)) throw new Error();
      payment = decoded;
    } catch { throw new X402Error(402, 'INVALID_PAYMENT'); }
    const key = createHash('sha256').update(JSON.stringify(payment.payload)).digest('hex');
    const binding = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const cached = await this.exclusive(async () => {
      const previous = this.bindings.get(key);
      if (previous !== undefined && previous !== binding) throw new X402Error(402, 'PAYMENT_REPLAY');
      return this.receipts.get(key);
    });
    if (cached) {
      if (cached.binding !== binding) throw new X402Error(402, 'PAYMENT_REPLAY');
      return Object.assign(async () => cached.receipt, { receipt: cached.receipt });
    }
    if (this.bindings.size >= 10000) throw new X402Error(503, 'PAYMENT_CAPACITY_EXCEEDED');
    const verified = await this.call('verify', payment);
    if (verified.isValid !== true) throw new X402Error(402, 'PAYMENT_INVALID');
    await this.exclusive(async () => {
      const previous = this.bindings.get(key);
      if (previous !== undefined && previous !== binding) throw new X402Error(402, 'PAYMENT_REPLAY');
      this.bindings.set(key, binding);
      await this.persist();
    });
    return async () => {
      const receipt = await this.call('settle', payment);
      if (receipt.success !== true) throw new X402Error(402, 'PAYMENT_SETTLEMENT_FAILED');
      if (receipt.network !== this.config.requirements.network || typeof receipt.transaction !== 'string' || !receipt.transaction) throw new X402Error(503, 'INVALID_SETTLEMENT_RESPONSE');
      await this.exclusive(async () => {
        this.receipts.set(key, { binding, receipt });
        await this.persist();
      });
      return receipt;
    };
  }
  private async call(method: 'verify' | 'settle', paymentPayload: object): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(`${this.config.facilitatorUrl.replace(/\/$/, '')}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
        body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements: this.config.requirements }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15000),
      });
      if (!response.ok) throw new Error();
      const body: unknown = await response.json();
      if (!record(body)) throw new Error();
      return body;
    } catch { throw new X402Error(503, 'PAYMENT_FACILITATOR_UNAVAILABLE'); }
  }
}

export function x402ConfigFromEnv(env: NodeJS.ProcessEnv): X402Config | undefined {
  if (env.X402_ENABLED !== 'true') return undefined;
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required when X402_ENABLED=true.`);
    return value;
  };
  return {
    facilitatorUrl: required('X402_FACILITATOR_URL'), resourceUrl: required('X402_RESOURCE_URL'),
    requirements: { scheme: 'exact', network: required('X402_NETWORK'), amount: required('X402_AMOUNT'), asset: required('X402_ASSET'), payTo: required('X402_PAY_TO'), maxTimeoutSeconds: Number(env.X402_MAX_TIMEOUT_SECONDS ?? '60'), extra: env.X402_EXTRA ? JSON.parse(env.X402_EXTRA) : undefined },
    timeoutMs: Number(env.X402_TIMEOUT_MS ?? '15000'),
    storePath: env.X402_STORE_PATH?.trim() || '.ossr/x402-payments.json',
  };
}
