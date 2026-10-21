import { createHash } from 'node:crypto';
import { validateStacksAddress } from '@stacks/transactions';
export type BetaAccessConfig = { walletTokens: Record<string, string>; requestsPerMinute?: number };
export class BetaAccessError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export class BetaAccess {
  private readonly tokens = new Map<string, string>();
  private readonly wallets = new Set<string>();
  private readonly requests = new Map<string, { minute: number; count: number }>();
  private readonly limit: number;
  constructor(config: BetaAccessConfig) {
    this.limit = config.requestsPerMinute ?? 30;
    if (!Number.isSafeInteger(this.limit) || this.limit < 1) throw new Error('Beta request limit must be a positive safe integer.');
    if (!config.walletTokens || Object.keys(config.walletTokens).length === 0) throw new Error('Beta access requires at least one wallet credential; an empty allowlist must not disable protection.');
    for (const [wallet, token] of Object.entries(config.walletTokens)) {
      if (!validateStacksAddress(wallet) || !/^(ST|SN)/.test(wallet)) throw new Error('Beta allowlist requires testnet wallet principals.');
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error('Beta credentials must be 43–128 base64url characters; generate at least 32 random bytes.');
      const digest = hash(token);
      if (this.tokens.has(digest)) throw new Error('Each beta wallet must have a distinct access credential.');
      this.tokens.set(digest, wallet); this.wallets.add(wallet);
    }
  }
  requireWallet(wallet: string): void {
    if (!this.wallets.has(wallet)) throw new BetaAccessError(403, 'WALLET_NOT_ALLOWED', 'This wallet is not invited to the testnet beta.');
  }
  authenticate(authorization: string | undefined, now = Date.now()): string {
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/);
    const wallet = match ? this.tokens.get(hash(match[1])) : undefined;
    if (!wallet) throw new BetaAccessError(401, 'BETA_ACCESS_REQUIRED', 'Provide the access credential issued for your invited wallet.');
    const minute = Math.floor(now / 60_000);
    const previous = this.requests.get(wallet);
    const bucket = previous?.minute === minute ? previous : { minute, count: 0 };
    this.requests.set(wallet, bucket);
    if (bucket.count >= this.limit) throw new BetaAccessError(429, 'RATE_LIMITED', 'Beta request limit reached. Wait until the next minute before retrying.');
    bucket.count++;
    return wallet;
  }
  bindOrigin(authorizedWallet: string, body: unknown, endpoint: 'quote' | 'sponsor'): void {
    const key = endpoint === 'quote' ? 'origin' : 'user';
    if (!body || typeof body !== 'object' || (body as Record<string, unknown>)[key] !== authorizedWallet) throw new BetaAccessError(403, 'BETA_ORIGIN_MISMATCH', 'The access credential does not authorize this transaction origin.');
  }
}
function hash(token: string) { return createHash('sha256').update(token).digest('hex'); }
export function betaAccessFromEnv(env: NodeJS.ProcessEnv): BetaAccessConfig | undefined {
  if (env.OSSR_BETA_ACCESS !== 'true') {
    if (env.OSSR_BETA_ACCESS && env.OSSR_BETA_ACCESS !== 'false') throw new Error('OSSR_BETA_ACCESS must be true or false.');
    return undefined;
  }
  if (!env.OSSR_BETA_WALLET_TOKENS) throw new Error('OSSR_BETA_WALLET_TOKENS is required when beta access is enabled.');
  let walletTokens: unknown;
  try { walletTokens = JSON.parse(env.OSSR_BETA_WALLET_TOKENS); }
  catch { throw new Error('OSSR_BETA_WALLET_TOKENS must be valid JSON. Credential contents are omitted.'); }
  if (!walletTokens || typeof walletTokens !== 'object' || Array.isArray(walletTokens)) throw new Error('OSSR_BETA_WALLET_TOKENS must be a JSON object.');
  return { walletTokens: walletTokens as Record<string, string>, requestsPerMinute: Number(env.OSSR_BETA_REQUESTS_PER_MINUTE ?? '30') };
}
