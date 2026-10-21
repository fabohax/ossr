import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
export type BetaBudgetConfig = {
  storePath: string;
  maximumTransferSats: bigint;
  walletDailyOutflowSats: bigint;
  dailyOutflowSats: bigint;
  dailySponsorMicroStx: bigint;
  unreimbursedMicroStx: bigint;
  timeZone?: string;
};
export class BetaBudgetError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export type BudgetEntry = {
  quoteId: string; origin: string; recipient: string; amountSats: string; sponsorFeeSats: string;
  reservedMicroStx: string; day: string; createdAt: string; updatedAt: string;
  txid?: string; failureCode?: string; outcome?: string; actualMicroStx?: string; reimbursedSats?: string; recipientPaidSats?: string;
};
type Reservation = Pick<BudgetEntry, 'quoteId' | 'origin' | 'recipient' | 'amountSats' | 'sponsorFeeSats' | 'reservedMicroStx'>;
// One process only. Never reclaim an ambiguous reservation based on timeout.
export class BetaBudget {
  private entries: BudgetEntry[] = [];
  private queue: Promise<void> = Promise.resolve();
  private readonly loaded: Promise<void>;
  private readonly date: Intl.DateTimeFormat;
  constructor(private readonly config: BetaBudgetConfig) {
    for (const key of ['maximumTransferSats', 'walletDailyOutflowSats', 'dailyOutflowSats', 'dailySponsorMicroStx', 'unreimbursedMicroStx'] as const) if (config[key] <= 0n) throw new Error(`Beta budget ${key} must be positive.`);
    this.date = new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone ?? 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' });
    this.loaded = this.load();
    void this.loaded.catch(() => undefined);
  }
  async ready(): Promise<void> { await this.loaded; }
  checkTransfer(amount: bigint): void {
    if (amount > this.config.maximumTransferSats) throw new BetaBudgetError('BETA_TRANSFER_LIMIT', 'Transfer exceeds the beta per-transfer limit.');
  }
  async reserve(input: Reservation, now = new Date()): Promise<void> {
    await this.exclusive(async () => {
      this.checkTransfer(BigInt(input.amountSats));
      for (const field of ['amountSats', 'sponsorFeeSats', 'reservedMicroStx'] as const) if (!/^[1-9][0-9]*$/.test(input[field])) throw new Error('Budget reservation amounts must be positive integer strings.');
      const existing = this.entries.find(entry => entry.quoteId === input.quoteId);
      if (existing) {
        if (Object.keys(input).some(key => input[key as keyof Reservation] !== existing[key as keyof Reservation])) throw new BetaBudgetError('BETA_RESERVATION_MISMATCH', 'This quote already has a different budget reservation.');
        if (existing.txid && existing.actualMicroStx === undefined) throw new BetaBudgetError('BETA_RESERVATION_PENDING', 'This quote already has a signed or ambiguous transaction. Reconcile it before retrying.');
        return;
      }
      const day = this.date.format(now);
      const today = this.entries.filter(entry => entry.day === day);
      const outflow = BigInt(input.amountSats) + BigInt(input.sponsorFeeSats);
      const total = (entries: BudgetEntry[], value: (entry: BudgetEntry) => bigint) => entries.reduce((sum, entry) => sum + value(entry), 0n);
      const movement = (entry: BudgetEntry) => BigInt(entry.amountSats) + BigInt(entry.sponsorFeeSats);
      // Outflow quotas remain conservative even for aborted/unknown transactions.
      if (total(today.filter(entry => entry.origin === input.origin), movement) + outflow > this.config.walletDailyOutflowSats) throw new BetaBudgetError('BETA_WALLET_LIMIT', 'Wallet daily beta outflow limit reached.');
      if (total(today, movement) + outflow > this.config.dailyOutflowSats) throw new BetaBudgetError('BETA_DAILY_LIMIT', 'Relay daily beta outflow limit reached.');
      const cost = (entry: BudgetEntry) => entry.failureCode?.startsWith('BETA_ACCOUNTING') ? max(BigInt(entry.actualMicroStx ?? '0'), BigInt(entry.reservedMicroStx)) : BigInt(entry.actualMicroStx ?? entry.reservedMicroStx);
      if (total(today, cost) + BigInt(input.reservedMicroStx) > this.config.dailySponsorMicroStx) throw new BetaBudgetError('BETA_STX_BUDGET', 'Daily sponsor STX budget reached.');
      const uncovered = this.entries.filter(entry => entry.failureCode?.startsWith('BETA_ACCOUNTING') || entry.outcome !== 'success' || entry.reimbursedSats !== entry.sponsorFeeSats);
      if (total(uncovered, cost) + BigInt(input.reservedMicroStx) > this.config.unreimbursedMicroStx) throw new BetaBudgetError('BETA_LOSS_CAP', 'Sponsor unreimbursed STX exposure cap reached. Reconcile existing transactions before retrying.');
      this.entries.push({ ...input, day, createdAt: now.toISOString(), updatedAt: now.toISOString() });
      await this.persist();
    });
  }
  async attachTransaction(quoteId: string, txid: string): Promise<void> {
    if (!/^(?:0x)?[0-9a-f]{64}$/i.test(txid)) throw new Error('Invalid budget transaction ID.');
    await this.exclusive(async () => {
      const entry = this.required(quoteId);
      const normalized = txid.replace(/^0x/, '').toLowerCase();
      if (entry.txid && entry.txid !== normalized) throw new BetaBudgetError('BETA_RESERVATION_MISMATCH', 'A quote cannot consume budget for two transaction IDs.');
      entry.txid = normalized; entry.updatedAt = new Date().toISOString();
      await this.persist();
    });
  }
  async recordFailure(quoteId: string, code: string): Promise<void> {
    if (!/^[A-Z0-9_]+$/.test(code)) throw new Error('Budget failure requires a stable error code.');
    await this.exclusive(async () => { const entry = this.entries.find(entry => entry.quoteId === quoteId); if (!entry) return; entry.failureCode = code; entry.updatedAt = new Date().toISOString(); await this.persist(); });
  }
  async reconcile(txid: string, raw: unknown, sponsor: string, asset: string): Promise<void> {
    try { await this.exclusive(async () => {
      const entry = this.entries.find(entry => entry.txid === txid.replace(/^0x/, '').toLowerCase());
      if (!entry) return;
      if (!raw || typeof raw !== 'object') { if (entry.actualMicroStx !== undefined) throw new BetaBudgetError('BETA_ACCOUNTING_INCOMPLETE', 'Previously settled chain receipt is unavailable; preserve sponsor exposure until reconciliation.'); return; }
      const tx = raw as Record<string, unknown>;
      if (typeof tx.tx_status !== 'string' || !(tx.tx_status === 'success' || tx.tx_status.startsWith('abort_'))) { if (entry.actualMicroStx !== undefined) throw new BetaBudgetError('BETA_ACCOUNTING_MISMATCH', 'A previously settled chain outcome changed.'); return; }
      if (typeof tx.tx_id !== 'string' || tx.tx_id.replace(/^0x/, '').toLowerCase() !== entry.txid || tx.sender_address !== entry.origin || tx.sponsor_address !== sponsor || tx.sponsored !== true || typeof tx.fee_rate !== 'string' || !/^[0-9]+$/.test(tx.fee_rate) || !Array.isArray(tx.events)) throw new BetaBudgetError('BETA_ACCOUNTING_MISMATCH', 'Chain receipt does not match the reserved sponsorship.');
      // Refuse truncated events: missing reimbursement must stay exposed, not be guessed.
      if (typeof tx.event_count !== 'number' || !Number.isSafeInteger(tx.event_count) || tx.event_count < 0 || tx.events.length !== tx.event_count) throw new BetaBudgetError('BETA_ACCOUNTING_INCOMPLETE', 'Fetch complete transaction events before accounting.');
      const expected = [{ recipient: sponsor, amount: entry.sponsorFeeSats }, { recipient: entry.recipient, amount: entry.amountSats }];
      if (tx.tx_status === 'success') {
        for (const event of tx.events) {
          const value = event as { event_type?: string; fungible_token_asset?: Record<string, unknown> };
          const other = event as { event_type?: string; stx_asset?: { sender?: string }; non_fungible_token_asset?: { sender?: string } };
          if ((other.event_type === 'stx_asset' && other.stx_asset?.sender === entry.origin) || (other.event_type === 'non_fungible_token_asset' && other.non_fungible_token_asset?.sender === entry.origin)) throw new BetaBudgetError('BETA_ACCOUNTING_MISMATCH', 'Unexpected origin STX or NFT movement in the chain receipt.');
          const ft = value?.fungible_token_asset;
          if (value?.event_type !== 'fungible_token_asset' || ft?.sender !== entry.origin) continue;
          const index = expected.findIndex(payment => payment.recipient === ft.recipient && payment.amount === ft.amount);
          if (ft.asset_event_type !== 'transfer' || ft.asset_id !== asset || index < 0) throw new BetaBudgetError('BETA_ACCOUNTING_MISMATCH', 'Chain asset movements differ from the reserved recipient payment and reimbursement.');
          expected.splice(index, 1);
        }
        if (expected.length) throw new BetaBudgetError('BETA_ACCOUNTING_MISMATCH', 'Chain receipt is missing the exact recipient payment or sponsor reimbursement.');
      }
      const reimbursement = tx.tx_status === 'success' ? entry.sponsorFeeSats : '0';
      if (entry.actualMicroStx !== undefined && (entry.actualMicroStx !== tx.fee_rate || entry.outcome !== tx.tx_status || entry.reimbursedSats !== reimbursement)) throw new BetaBudgetError('BETA_ACCOUNTING_MISMATCH', 'A settled accounting receipt changed. Operator reconciliation is required.');
      entry.actualMicroStx = tx.fee_rate; entry.reimbursedSats = reimbursement; entry.recipientPaidSats = tx.tx_status === 'success' ? entry.amountSats : '0'; entry.outcome = tx.tx_status;
      if (entry.failureCode?.startsWith('BETA_ACCOUNTING')) delete entry.failureCode;
      entry.updatedAt = new Date().toISOString(); await this.persist();
    }); } catch (error) {
      if (error instanceof BetaBudgetError && error.code.startsWith('BETA_ACCOUNTING')) {
        const entry = this.entries.find(entry => entry.txid === txid.replace(/^0x/, '').toLowerCase());
        if (entry) await this.recordFailure(entry.quoteId, error.code);
      }
      throw error;
    }
  }
  async snapshot(): Promise<BudgetEntry[]> { await this.loaded; await this.queue; return structuredClone(this.entries); }
  private required(quoteId: string) { const entry = this.entries.find(value => value.quoteId === quoteId); if (!entry) throw new Error('Missing beta budget reservation.'); return entry; }
  private async exclusive(operation: () => Promise<void>) {
    const previous = this.queue; let release!: () => void;
    this.queue = new Promise(resolve => { release = resolve; });
    await previous;
    try { await this.loaded; const before = structuredClone(this.entries); try { await operation(); } catch (error) { this.entries = before; throw error; } } finally { release(); }
  }
  private async load() {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.config.storePath, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('Beta ledger must be an array.');
      const seen = new Set<string>();
      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object' || typeof entry.quoteId !== 'string' || typeof entry.origin !== 'string' || typeof entry.recipient !== 'string' || seen.has(entry.quoteId) || typeof entry.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.day) || !['amountSats','sponsorFeeSats','reservedMicroStx'].every(key => typeof entry[key] === 'string' && /^[1-9][0-9]*$/.test(entry[key])) || (entry.actualMicroStx !== undefined && !/^[0-9]+$/.test(entry.actualMicroStx)) || (entry.reimbursedSats !== undefined && !/^[0-9]+$/.test(entry.reimbursedSats))) throw new Error('Malformed beta budget ledger; refusing new sponsorships.');
        seen.add(entry.quoteId);
      }
      this.entries = parsed;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  private async persist() {
    await mkdir(dirname(this.config.storePath), { recursive: true });
    const temporary = `${this.config.storePath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
    await writeFile(temporary, JSON.stringify(this.entries, null, 2), { mode: 0o600 });
    await rename(temporary, this.config.storePath);
  }
}
export function betaBudgetFromEnv(env: NodeJS.ProcessEnv): BetaBudgetConfig | undefined {
  if (env.OSSR_BETA_BUDGETS !== 'true') { if (env.OSSR_BETA_BUDGETS && env.OSSR_BETA_BUDGETS !== 'false') throw new Error('OSSR_BETA_BUDGETS must be true or false.'); return undefined; }
  const value = (name: string) => { const raw = env[name]; if (!raw || !/^[1-9][0-9]*$/.test(raw)) throw new Error(`${name} must be explicitly configured as a positive integer.`); return BigInt(raw); };
  return {
    storePath: env.OSSR_BETA_LEDGER_PATH || '.ossr/beta-ledger.json', timeZone: env.OSSR_BETA_TIME_ZONE || 'America/Lima',
    maximumTransferSats: value('OSSR_BETA_MAX_TRANSFER_SATS'), walletDailyOutflowSats: value('OSSR_BETA_WALLET_DAILY_SATS'), dailyOutflowSats: value('OSSR_BETA_DAILY_SATS'), dailySponsorMicroStx: value('OSSR_BETA_DAILY_STX_MICROSTX'), unreimbursedMicroStx: value('OSSR_BETA_LOSS_CAP_MICROSTX'),
  };
}

function max(a: bigint, b: bigint) { return a > b ? a : b; }
