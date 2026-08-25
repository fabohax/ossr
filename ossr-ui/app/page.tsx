'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, Loader2, Plug, Radio, Send, Wallet } from 'lucide-react';
import {
  adapterErrorFromStatus,
  describeChainStatus,
  extractRawTransaction,
  fetchRelayInfo,
  fetchSbtcBalance,
  fetchSponsorshipStatus,
  isFailedChainStatus,
  isTerminalChainStatus,
  likelyFailureCause,
  prepareWalletContractCall,
  requestQuote,
  submitSponsorship,
  type QuoteResponse,
  type RelayInfo,
  type SbtcBalance,
  type SponsorshipResponse,
  type SponsorshipStatus,
} from '../lib/ossr';
import styles from './page.module.css';

type WalletAddress = {
  symbol?: string;
  address?: string;
  publicKey?: string;
};

const connectedAddressKey = 'ossr-ui:connected-stx-address';

function defaultRelayUrl(): string {
  if (process.env.NEXT_PUBLIC_OSSR_RELAY_URL) return process.env.NEXT_PUBLIC_OSSR_RELAY_URL;
  if (typeof window === 'undefined') return 'http://127.0.0.1:3002';
  return `http://${window.location.hostname}:3002`;
}

function savedConnectedAddress(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(connectedAddressKey) ?? '';
}

export default function Home() {
  const [relayUrl, setRelayUrl] = useState(defaultRelayUrl);
  const [relayInfo, setRelayInfo] = useState<RelayInfo>();
  const [origin, setOrigin] = useState(savedConnectedAddress);
  const [recipient, setRecipient] = useState('');
  const [amountSats, setAmountSats] = useState('100');
  const [maxSponsorFeeSats, setMaxSponsorFeeSats] = useState('10');
  const [memo, setMemo] = useState('');
  const [quoteResponse, setQuoteResponse] = useState<QuoteResponse>();
  const [sponsorship, setSponsorship] = useState<SponsorshipResponse>();
  const [status, setStatus] = useState<SponsorshipStatus>();
  const [sbtcBalance, setSbtcBalance] = useState<SbtcBalance>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [autoRelayChecked, setAutoRelayChecked] = useState(false);

  const totalSats = useMemo(() => {
    if (!quoteResponse?.quote.sponsorFee || !/^\d+$/.test(amountSats)) return undefined;
    return (BigInt(amountSats) + BigInt(quoteResponse.quote.sponsorFee)).toString();
  }, [amountSats, quoteResponse]);

  const txid = sponsorship?.transactionId ?? sponsorship?.transaction_id;
  const failed = isFailedChainStatus(status?.status);
  const terminal = isTerminalChainStatus(status?.status);

  async function loadRelayInfo({ quiet = false }: { quiet?: boolean } = {}) {
    const info = await fetchRelayInfo(relayUrl);
    setRelayInfo(info);
    if (info.limits?.sponsorFeeSats) setMaxSponsorFeeSats(info.limits.sponsorFeeSats);
    if (!quiet) setError(undefined);
    return info;
  }

  useEffect(() => {
    const hydrateSavedAddress = () => {
      const saved = window.localStorage.getItem(connectedAddressKey);
      if (saved && !origin) setOrigin(saved);
    };
    hydrateSavedAddress();
    const interval = window.setInterval(hydrateSavedAddress, 500);
    window.addEventListener('focus', hydrateSavedAddress);
    document.addEventListener('visibilitychange', hydrateSavedAddress);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', hydrateSavedAddress);
      document.removeEventListener('visibilitychange', hydrateSavedAddress);
    };
  }, [origin]);

  useEffect(() => {
    let cancelled = false;
    const loadAvailableRelay = async () => {
      setBusy(current => current ?? 'relay');
      try {
        const info = await fetchRelayInfo(relayUrl);
        if (cancelled) return;
        setRelayInfo(info);
        if (info.limits?.sponsorFeeSats) setMaxSponsorFeeSats(info.limits.sponsorFeeSats);
      } catch {
        if (!cancelled) setRelayInfo(undefined);
      } finally {
        if (!cancelled) {
          setAutoRelayChecked(true);
          setBusy(current => current === 'relay' ? undefined : current);
        }
      }
    };
    void loadAvailableRelay();
    return () => {
      cancelled = true;
    };
  }, [relayUrl]);

  useEffect(() => {
    if (!origin) {
      setSbtcBalance(undefined);
      return;
    }
    window.localStorage.setItem(connectedAddressKey, origin);
    let cancelled = false;
    const refresh = async () => {
      try {
        const balance = await fetchSbtcBalance(origin, relayInfo?.sbtcContract);
        if (!cancelled) setSbtcBalance(balance);
      } catch {
        if (!cancelled) setSbtcBalance(undefined);
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [origin, relayInfo?.sbtcContract]);

  useEffect(() => {
    if (!txid) return;
    if (terminal) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await fetchSponsorshipStatus(relayUrl, txid);
        if (!cancelled) setStatus(next);
      } catch {
        // Status polling is best-effort; submit errors are shown in the main flow.
      }
    };
    void poll();
    const interval = window.setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [relayUrl, txid, terminal]);

  useEffect(() => {
    if (!terminal) return;
    setBusy(undefined);
  }, [terminal]);

  async function run<T>(label: string, operation: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError(undefined);
    try {
      return await operation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return undefined;
    } finally {
      setBusy(undefined);
    }
  }

  async function connectWallet() {
    await run('wallet', async () => {
      const { request } = await import('@stacks/connect');
      const response = await request('getAddresses');
      const addresses = readAddresses(response);
      const stx = addresses.find(address => address.symbol === 'STX' && address.address);
      if (!stx?.address) throw new Error('Wallet did not return a Stacks address.');
      setOrigin(stx.address);
      window.localStorage.setItem(connectedAddressKey, stx.address);
    });
  }

  async function loadRelay() {
    await run('relay', async () => {
      await loadRelayInfo();
    });
  }

  async function createQuote() {
    await run('quote', async () => {
      const quote = await requestQuote({
        relayUrl,
        origin,
        recipient,
        amountSats,
        maxSponsorFeeSats,
        ...(memo.trim() ? { memo: normalizeMemo(memo) } : {}),
      });
      setQuoteResponse(quote);
      setSponsorship(undefined);
      setStatus(undefined);
    });
  }

  function resetForNewQuote() {
    setQuoteResponse(undefined);
    setSponsorship(undefined);
    setStatus(undefined);
    setError(undefined);
  }

  function disconnectWallet() {
    setOrigin('');
    setSbtcBalance(undefined);
    window.localStorage.removeItem(connectedAddressKey);
  }

  async function signAndSubmit() {
    await run('submit', async () => {
      if (!quoteResponse) throw new Error('Request a quote first.');
      const { request } = await import('@stacks/connect');
      const prepared = prepareWalletContractCall({
        quote: quoteResponse.quote,
        recipient,
        amountSats,
        ...(memo.trim() ? { memo: normalizeMemo(memo) } : {}),
      });
      const walletResult = await request('stx_callContract', {
        contract: prepared.contract,
        functionName: prepared.functionName,
        functionArgs: prepared.functionArgs,
        postConditions: prepared.postConditions,
        postConditionMode: prepared.postConditionMode,
        sponsored: true,
        network: 'testnet',
      });
      const transaction = extractRawTransaction(walletResult);
      if (!transaction) throw new Error('Wallet did not return raw signed transaction bytes. This wallet may only support sign-and-broadcast contract calls.');
      const response = await submitSponsorship({
        relayUrl,
        quoteId: quoteResponse.quote.quoteId,
        transaction,
        user: origin,
      });
      setSponsorship(response);
    });
  }

  const canQuote = Boolean(origin && recipient && amountSats && maxSponsorFeeSats);
  const canSubmit = Boolean(quoteResponse && !sponsorship && !failed);

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <aside className={styles.side}>
          <div className={styles.brand}>
            <div className={styles.mark}>O</div>
            <div>
              <h1>OSSR</h1>
              <p>sBTC sponsored transfer</p>
            </div>
          </div>
          <div className={styles.statusStack}>
            <StatusRow icon={<Radio size={18} />} label="Relay" value={relayInfo ? relayInfo.relayId : autoRelayChecked ? 'Not loaded' : 'Checking'} ok={Boolean(relayInfo)} />
            <StatusRow icon={<Wallet size={18} />} label="Wallet" value={origin || 'Not connected'} ok={Boolean(origin)} />
            <StatusRow icon={<CheckCircle2 size={18} />} label="sBTC" value={sbtcBalance ? `${sbtcBalance.balanceSats} sats` : origin ? 'Loading' : '-'} ok={Boolean(sbtcBalance)} />
            <StatusRow icon={<CheckCircle2 size={18} />} label="Quote" value={quoteResponse ? `${quoteResponse.quote.sponsorFee} sats` : 'None'} ok={Boolean(quoteResponse)} />
            <StatusRow icon={<Send size={18} />} label="Tx" value={status?.status ?? sponsorship?.status ?? 'Not submitted'} ok={Boolean(sponsorship) && !failed} />
          </div>
        </aside>

        <section className={styles.work}>
          <div className={styles.toolbar}>
            <input aria-label="Relay URL" value={relayUrl} onChange={event => setRelayUrl(event.target.value)} />
            <button type="button" onClick={loadRelay} disabled={Boolean(busy)}>
              {busy === 'relay' ? <Loader2 className={styles.spin} size={18} /> : <Plug size={18} />}
              Load
            </button>
            <button type="button" onClick={connectWallet} disabled={Boolean(busy)}>
              {busy === 'wallet' ? <Loader2 className={styles.spin} size={18} /> : <Wallet size={18} />}
              Connect
            </button>
            {origin ? (
              <button type="button" onClick={disconnectWallet} disabled={Boolean(busy)}>
                <Wallet size={18} />
                Forget
              </button>
            ) : null}
          </div>

          <div className={styles.grid}>
            <form className={styles.form} onSubmit={event => { event.preventDefault(); void createQuote(); }}>
              <label>
                Origin
                <input value={origin} onChange={event => setOrigin(event.target.value)} placeholder="ST..." />
              </label>
              <div className={styles.balanceStrip}>
                <span>Available testnet sBTC</span>
                <strong>{sbtcBalance ? `${sbtcBalance.balanceSats} sats` : origin ? 'Loading' : '-'}</strong>
              </div>
              <label>
                Recipient
                <input value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="ST..." />
              </label>
              <label>
                Amount
                <input value={amountSats} onChange={event => setAmountSats(event.target.value)} inputMode="numeric" />
              </label>
              <label>
                Max sponsor fee
                <input value={maxSponsorFeeSats} onChange={event => setMaxSponsorFeeSats(event.target.value)} inputMode="numeric" />
              </label>
              <label className={styles.full}>
                Memo hex
                <input value={memo} onChange={event => setMemo(event.target.value)} placeholder="optional, 0x..." />
              </label>
              <button className={styles.primary} type="submit" disabled={!canQuote || Boolean(busy)}>
                {busy === 'quote' ? <Loader2 className={styles.spin} size={18} /> : <ArrowRight size={18} />}
                Get quote
              </button>
            </form>

            <section className={styles.review}>
              <h2>Review</h2>
              <dl>
                <div><dt>Adapter</dt><dd>{quoteResponse?.quote.adapterContract ?? relayInfo?.adapterContract ?? '-'}</dd></div>
                <div><dt>sBTC outflow</dt><dd>{totalSats ? `${totalSats} sats` : '-'}</dd></div>
                <div><dt>Expires</dt><dd>{quoteResponse?.quote.expiresAtBlock ?? '-'}</dd></div>
                <div><dt>Quote ID</dt><dd>{quoteResponse?.quote.quoteId ?? '-'}</dd></div>
                <div><dt>Transaction</dt><dd><TransactionId txid={txid} successful={status?.status === 'success'} /></dd></div>
              </dl>
              {sponsorship ? (
                <TransactionOutcome
                  status={status}
                  txid={txid}
                  failed={failed}
                  amountSats={amountSats}
                  sponsorFeeSats={quoteResponse?.quote.sponsorFee}
                  origin={origin}
                />
              ) : null}
              {sponsorship ? (
                <button className={styles.secondary} type="button" onClick={resetForNewQuote} disabled={Boolean(busy)}>
                  <ArrowRight size={18} />
                  New quote
                </button>
              ) : (
                <button className={styles.primary} type="button" onClick={signAndSubmit} disabled={!canSubmit || Boolean(busy)}>
                  {busy === 'submit' ? <Loader2 className={styles.spin} size={18} /> : <Send size={18} />}
                  Sign and sponsor
                </button>
              )}
            </section>
          </div>

          {error ? <div className={styles.error}><CircleAlert size={18} />{error}</div> : null}
        </section>
      </section>
    </main>
  );
}

function TransactionOutcome({
  status,
  txid,
  failed,
  amountSats,
  sponsorFeeSats,
  origin,
}: {
  status?: SponsorshipStatus;
  txid?: string;
  failed: boolean;
  amountSats?: string;
  sponsorFeeSats?: string;
  origin?: string;
}) {
  const raw = status?.raw ? JSON.stringify(status.raw, null, 2) : undefined;
  const cause = likelyFailureCause(status, { amountSats, sponsorFeeSats, origin });
  const adapterError = adapterErrorFromStatus(status);
  const requiredSats = amountSats && sponsorFeeSats && /^\d+$/.test(amountSats) && /^\d+$/.test(sponsorFeeSats)
    ? (BigInt(amountSats) + BigInt(sponsorFeeSats)).toString()
    : undefined;
  return (
    <div className={failed ? styles.failurePanel : styles.outcomePanel}>
      <div className={styles.outcomeHeader}>
        {failed ? <CircleAlert size={18} /> : <CheckCircle2 size={18} />}
        <strong>{status?.status ?? 'BROADCAST'}</strong>
      </div>
      <p>{describeChainStatus(status)}</p>
      <dl>
        <div><dt>Txid</dt><dd><TransactionId txid={txid} successful={status?.status === 'success'} /></dd></div>
        <div><dt>Block height</dt><dd>{status?.blockHeight ?? '-'}</dd></div>
        {adapterError ? <div><dt>Adapter error</dt><dd>{adapterError.name} (u{adapterError.code})</dd></div> : null}
        {requiredSats ? <div><dt>Required sBTC</dt><dd>{requiredSats} sats</dd></div> : null}
        {cause ? <div><dt>Likely cause</dt><dd>{cause}</dd></div> : null}
      </dl>
      {raw ? <pre>{raw}</pre> : null}
    </div>
  );
}

function TransactionId({ txid, successful }: { txid?: string; successful: boolean }) {
  if (!txid) return '-';
  if (!successful) return txid;
  return (
    <a className={styles.txLink} href={hiroTxUrl(txid)} target="_blank" rel="noreferrer">
      {txid}
    </a>
  );
}

function hiroTxUrl(txid: string): string {
  const normalized = txid.startsWith('0x') ? txid : `0x${txid}`;
  return `https://explorer.hiro.so/txid/${normalized}?chain=testnet`;
}

function StatusRow({ icon, label, value, ok }: { icon: React.ReactNode; label: string; value: string; ok: boolean }) {
  return (
    <div className={styles.statusRow}>
      <span className={ok ? styles.okIcon : styles.idleIcon}>{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function normalizeMemo(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
}

function readAddresses(response: unknown): WalletAddress[] {
  if (!isRecord(response)) return [];
  const result = isRecord(response.result) ? response.result : response;
  return Array.isArray(result.addresses) ? result.addresses as WalletAddress[] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
