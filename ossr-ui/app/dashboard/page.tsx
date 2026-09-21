'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, ExternalLink, Loader2, LogOut, Radio, RefreshCw, Send, ShieldCheck, Wallet } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { enableDarkStacksWalletSelector } from '@/lib/stacks-wallet-theme';
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
  RelayRequestError,
  submitSponsorship,
  type QuoteResponse,
  type RelayInfo,
  type SbtcBalance,
  type SponsorshipResponse,
  type SponsorshipStatus,
} from '../../lib/ossr';

type WalletAddress = {
  symbol?: string;
  address?: string;
  publicKey?: string;
};

const connectedAddressKey = 'ossr-ui:connected-stx-address';
const recentRecipientsKey = 'ossr-ui:recent-recipients';

function savedRecentRecipients(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = JSON.parse(window.localStorage.getItem(recentRecipientsKey) ?? '[]');
    return Array.isArray(saved) ? saved.filter((value): value is string => typeof value === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}

function estimatedSponsorFee(amount: bigint, limits?: RelayInfo['limits']): bigint {
  const fixed = limits?.sponsorFeeSats && /^\d+$/.test(limits.sponsorFeeSats)
    ? BigInt(limits.sponsorFeeSats)
    : undefined;
  const legacyPercentage = limits?.sponsorFeeBps && /^\d+$/.test(limits.sponsorFeeBps)
    ? (amount * BigInt(limits.sponsorFeeBps) + 9_999n) / 10_000n
    : undefined;
  const scale = limits?.pricingScaleSats && /^[1-9]\d*$/.test(limits.pricingScaleSats)
    ? BigInt(limits.pricingScaleSats)
    : 100n;
  const growth = limits?.pricingGrowthSats && /^[1-9]\d*$/.test(limits.pricingGrowthSats)
    ? BigInt(limits.pricingGrowthSats)
    : 2n;
  const logarithmic = growth * ceilLog2(1n + (amount + scale - 1n) / scale);
  const requested = fixed ?? legacyPercentage ?? logarithmic;
  const minimum = BigInt(limits?.minimumSponsorFeeSats && /^\d+$/.test(limits.minimumSponsorFeeSats) ? limits.minimumSponsorFeeSats : '1');
  const breakEven = BigInt(limits?.breakEvenFeeSats && /^\d+$/.test(limits.breakEvenFeeSats) ? limits.breakEvenFeeSats : '1');
  return [requested, minimum, breakEven].reduce((maximum, fee) => fee > maximum ? fee : maximum, 1n);
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

function defaultRelayUrl(): string {
  if (process.env.NEXT_PUBLIC_OSSR_RELAY_URL) return process.env.NEXT_PUBLIC_OSSR_RELAY_URL;
  if (typeof window === 'undefined') return 'http://127.0.0.1:3002';
  return `http://${window.location.hostname}:3002`;
}

function savedConnectedAddress(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(connectedAddressKey) ?? '';
}

type DisplayError = { title: string; message: string; action?: string; code?: string };

const errorGuidance: Record<string, Pick<DisplayError, 'title' | 'action'>> = {
  QUOTE_EXPIRED: { title: 'This quote has expired', action: 'Go back and request a fresh quote, then approve it promptly.' },
  QUOTE_ALREADY_USED: { title: 'This quote was already used', action: 'Go back and request a new quote.' },
  QUOTE_ORIGIN_MISMATCH: { title: 'The connected wallet changed', action: 'Reconnect the wallet that requested this quote, or request a new quote.' },
  ORIGIN_MISMATCH: { title: 'The signing wallet does not match', action: 'Reconnect the wallet shown in the transfer details and try again.' },
  INVALID_ORIGIN_SIGNATURE: { title: 'The wallet signature could not be verified', action: 'Reject any pending wallet request, then approve the transaction again.' },
  SPONSOR_FEE_TOO_HIGH: { title: 'The sponsor fee is above your limit', action: 'Go back, request a new quote, and review the updated fee.' },
  SIMULATION_FAILED: { title: 'The transaction would fail on-chain', action: 'Check that your wallet has enough testnet sBTC for the amount and sponsor fee, then request a new quote.' },
  INVALID_POST_CONDITIONS: { title: 'The wallet changed the transfer safeguards', action: 'Try again with a wallet that supports the exact post-conditions shown in this review.' },
  QUOTE_TRANSACTION_MISMATCH: { title: 'The signed transaction does not match this quote', action: 'Go back and request a new quote before signing again.' },
  WRONG_NETWORK: { title: 'Your wallet is on the wrong network', action: 'Switch the wallet to Stacks testnet and try again.' },
  UNSUPPORTED_AUTH: { title: 'The wallet did not create a sponsored transaction', action: 'Use a wallet that supports sponsored Stacks contract calls.' },
  FEE_OUT_OF_POLICY: { title: 'The network fee is outside relay limits', action: 'Request a new quote later, when testnet fees have changed.' },
};

function displayError(error: unknown): DisplayError {
  if (error instanceof RelayRequestError) {
    const guidance = error.code ? errorGuidance[error.code] : undefined;
    return {
      title: guidance?.title ?? (error.status === 422 ? 'The relay could not approve this transaction' : 'The relay rejected the request'),
      message: error.message,
      action: guidance?.action,
      code: [error.code, `HTTP ${error.status}`].filter(Boolean).join(' · '),
    };
  }
  if (error instanceof TypeError && /fetch|network|failed/i.test(error.message)) {
    return { title: 'The relay could not be reached', message: 'The relay may be offline or blocked by your network.', action: 'Check the relay endpoint and your connection, then try again.' };
  }
  return {
    title: 'We couldn\'t complete that request',
    message: error instanceof Error ? error.message : String(error),
  };
}

export default function Home({ embedded = false, onWalletChange }: { embedded?: boolean; onWalletChange?: (address: string) => void }) {
  const [relayUrl, setRelayUrl] = useState(defaultRelayUrl);
  const [relayInfo, setRelayInfo] = useState<RelayInfo>();
  const [origin, setOrigin] = useState(savedConnectedAddress);
  const [recipient, setRecipient] = useState('');
  const [recentRecipients, setRecentRecipients] = useState(savedRecentRecipients);
  const [amountSats, setAmountSats] = useState('');
  const [maxSponsorFeeSats, setMaxSponsorFeeSats] = useState('1');
  const [memo, setMemo] = useState('');
  const [quoteResponse, setQuoteResponse] = useState<QuoteResponse>();
  const [sponsorship, setSponsorship] = useState<SponsorshipResponse>();
  const [status, setStatus] = useState<SponsorshipStatus>();
  const [sbtcBalance, setSbtcBalance] = useState<SbtcBalance>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<DisplayError>();
  const [autoRelayChecked, setAutoRelayChecked] = useState(false);
  const [transactionModalOpen, setTransactionModalOpen] = useState(false);
  const [statusObservationCount, setStatusObservationCount] = useState(0);
  const statusObservation = useRef({ value: '', count: 0 });
  const recipientComboboxPortalRef = useRef<HTMLDivElement>(null);

  const totalSats = useMemo(() => {
    if (!quoteResponse?.quote.sponsorFee || !/^\d+$/.test(amountSats)) return undefined;
    return (BigInt(amountSats) + BigInt(quoteResponse.quote.sponsorFee)).toString();
  }, [amountSats, quoteResponse]);

  const defaultSponsorFeeSats = useMemo(() => {
    const amount = /^[1-9]\d*$/.test(amountSats) ? BigInt(amountSats) : 0n;
    return estimatedSponsorFee(amount, relayInfo?.limits).toString();
  }, [amountSats, relayInfo]);

  function setMaximumAmount() {
    if (!sbtcBalance || !/^\d+$/.test(sbtcBalance.balanceSats)) return;
    const balance = BigInt(sbtcBalance.balanceSats);
    let low = 0n;
    let high = balance;
    while (low < high) {
      const candidate = (low + high + 1n) / 2n;
      if (candidate + estimatedSponsorFee(candidate, relayInfo?.limits) <= balance) low = candidate;
      else high = candidate - 1n;
    }
    setAmountSats(low.toString());
  }

  const memoByteLength = useMemo(() => new TextEncoder().encode(memo).length, [memo]);

  const estimatedTotalSats = useMemo(() => {
    if (!/^[1-9]\d*$/.test(amountSats) || !/^\d+$/.test(defaultSponsorFeeSats)) return undefined;
    return BigInt(amountSats) + BigInt(defaultSponsorFeeSats);
  }, [amountSats, defaultSponsorFeeSats]);

  const insufficientBalance = useMemo(() => {
    if (!sbtcBalance || estimatedTotalSats === undefined || !/^\d+$/.test(sbtcBalance.balanceSats)) return false;
    return estimatedTotalSats > BigInt(sbtcBalance.balanceSats);
  }, [estimatedTotalSats, sbtcBalance]);

  const txid = sponsorship?.transactionId ?? sponsorship?.transaction_id;
  const statusNeedsConfirmation = status?.status === 'dropped_replace_by_fee' || status?.status === 'not_found';
  const provisionalStatus = Boolean(statusNeedsConfirmation && statusObservationCount < 3);
  const failed = isFailedChainStatus(status?.status) && !provisionalStatus;
  const terminal = isTerminalChainStatus(status?.status) && !provisionalStatus;

  async function loadRelayInfo({ quiet = false }: { quiet?: boolean } = {}) {
    const info = await fetchRelayInfo(relayUrl);
    setRelayInfo(info);
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
    setMaxSponsorFeeSats(defaultSponsorFeeSats);
  }, [defaultSponsorFeeSats]);

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
        if (!cancelled) {
          const observed = statusObservation.current;
          const count = observed.value === next.status ? observed.count + 1 : 1;
          statusObservation.current = { value: next.status, count };
          setStatusObservationCount(count);
          setStatus(next);
        }
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
      setError(displayError(caught));
      return undefined;
    } finally {
      setBusy(undefined);
    }
  }

  function clearConnectedWalletState() {
    window.localStorage.removeItem(connectedAddressKey);
    setOrigin('');
    setSbtcBalance(undefined);
    setQuoteResponse(undefined);
    setSponsorship(undefined);
    setStatus(undefined);
    onWalletChange?.('');
  }

  async function connectWallet({ replaceCurrent = false }: { replaceCurrent?: boolean } = {}) {
    await run('wallet', async () => {
      const { connect, disconnect } = await import('@stacks/connect');
      if (replaceCurrent) {
        disconnect();
        clearConnectedWalletState();
      }
      const stopWalletThemeObserver = enableDarkStacksWalletSelector();
      const response = await connect({ forceWalletSelect: true }).finally(stopWalletThemeObserver);
      const addresses = readAddresses(response);
      const stx = addresses.find(address => address.symbol === 'STX' && address.address);
      if (!stx?.address) throw new Error('Wallet did not return a Stacks address.');
      setOrigin(stx.address);
      window.localStorage.setItem(connectedAddressKey, stx.address);
      onWalletChange?.(stx.address);
    });
  }

  async function loadRelay() {
    await run('relay', async () => {
      await loadRelayInfo();
    });
  }

  async function createQuote() {
    const quote = await run('quote', async () => {
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
      statusObservation.current = { value: '', count: 0 };
      setStatusObservationCount(0);
      return quote;
    });
    if (quote) {
      const updatedRecipients = [recipient, ...recentRecipients.filter(address => address !== recipient)].slice(0, 5);
      setRecentRecipients(updatedRecipients);
      window.localStorage.setItem(recentRecipientsKey, JSON.stringify(updatedRecipients));
      await signAndSubmit(quote);
    }
  }

  async function replaceObsoleteQuote(): Promise<QuoteResponse> {
    const freshQuote = await requestQuote({
      relayUrl,
      origin,
      recipient,
      amountSats,
      maxSponsorFeeSats,
      ...(memo.trim() ? { memo: normalizeMemo(memo) } : {}),
    });
    setQuoteResponse(freshQuote);
    return freshQuote;
  }

  function resetForNewQuote() {
    setTransactionModalOpen(false);
    setQuoteResponse(undefined);
    setSponsorship(undefined);
    setStatus(undefined);
    statusObservation.current = { value: '', count: 0 };
    setStatusObservationCount(0);
    setError(undefined);
  }

  async function disconnectWallet() {
    await run('wallet', async () => {
      const { disconnect } = await import('@stacks/connect');
      disconnect();
      clearConnectedWalletState();
    });
  }

  async function signAndSubmit(quoteToSubmit = quoteResponse) {
    await run('submit', async () => {
      if (!quoteToSubmit) throw new Error('Request a quote first.');
      const { request } = await import('@stacks/connect');
      const prepared = prepareWalletContractCall({
        quote: quoteToSubmit.quote,
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
      let response: SponsorshipResponse;
      try {
        response = await submitSponsorship({
          relayUrl,
          quoteId: quoteToSubmit.quote.quoteId,
          transaction,
          user: origin,
        });
      } catch (caught) {
        const obsoleteQuote = caught instanceof RelayRequestError
          && ['QUOTE_EXPIRED', 'QUOTE_NOT_FOUND', 'QUOTE_ALREADY_USED'].includes(caught.code ?? '');
        if (!obsoleteQuote) throw caught;
        const freshQuote = await replaceObsoleteQuote();
        setError({
          title: 'Your quote was refreshed',
          message: 'The previous quote became obsolete before it could be submitted.',
          action: `Review the updated ${freshQuote.quote.sponsorFee} sat sponsor fee, then approve again in your wallet.`,
          code: caught.code,
        });
        return;
      }
      statusObservation.current = { value: '', count: 0 };
      setStatusObservationCount(0);
      setSponsorship(response);
      setTransactionModalOpen(true);
    });
  }

  const canQuote = Boolean(origin && recipient && amountSats && maxSponsorFeeSats && memoByteLength <= 34 && !insufficientBalance);
  return (
    <main className={embedded ? 'bg-background text-foreground' : 'min-h-screen bg-background text-foreground'}>
      <div className={embedded ? 'mx-auto flex w-full flex-col' : 'mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pt-5 pb-72 sm:px-6 sm:pb-44 lg:px-8 lg:pt-8 lg:pb-32'}>
        {!embedded ? <header className="mb-8 flex flex-col gap-5 border-b border-border pb-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight">Open Stacks Sponsor Relay</h1>
                <Badge variant="secondary">Testnet</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Send sBTC without holding STX. The relay pays the network fee.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={relayInfo ? 'default' : 'outline'} className="h-8 gap-1.5 px-3">
              <Radio className="size-3.5" />
              {relayInfo ? 'Relay online' : autoRelayChecked ? 'Relay offline' : 'Checking relay'}
            </Badge>
            {origin ? (
              <div className="flex gap-2">
                <Button variant="outline" size="lg" onClick={() => void connectWallet({ replaceCurrent: true })} disabled={Boolean(busy)}>
                  {busy === 'wallet' ? <Loader2 className="animate-spin" /> : <Wallet />}
                  Change wallet
                </Button>
                <Button variant="outline" size="lg" onClick={() => void disconnectWallet()} disabled={Boolean(busy)}>
                  <LogOut />
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button size="lg" onClick={() => void connectWallet()} disabled={Boolean(busy)}>
                {busy === 'wallet' ? <Loader2 className="animate-spin" /> : <Wallet />}
                Connect wallet
              </Button>
            )}
          </div>
        </header> : null}

        {!embedded ? <Alert className="mb-6 border-primary/20 bg-primary/5">
          <ShieldCheck />
          <AlertTitle>Prototype transaction on Stacks testnet</AlertTitle>
          <AlertDescription>The wallet authorizes an exact sBTC outflow. The sponsor pays STX and receives the quoted fee atomically.</AlertDescription>
        </Alert> : null}

        {!embedded ? <section className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 shadow-[0_-12px_40px_rgba(0,0,0,0.24)] backdrop-blur sm:px-6 lg:px-8" aria-label="Transfer status">
          <div className="mx-auto grid w-full max-w-7xl gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatusRow icon={<Radio />} label="Relay" value={relayInfo?.relayId ?? 'Not loaded'} ok={Boolean(relayInfo)} />
            <StatusRow icon={<Wallet />} label="Wallet" value={origin ? compact(origin) : 'Not connected'} ok={Boolean(origin)} />
            <StatusRow icon={<CheckCircle2 />} label="Balance" value={sbtcBalance ? `${sbtcBalance.balanceSats} sats` : origin ? 'Loading' : '—'} ok={Boolean(sbtcBalance)} />
            <StatusRow icon={<CheckCircle2 />} label="Quote" value={quoteResponse ? `${quoteResponse.quote.sponsorFee} sats` : 'Not requested'} ok={Boolean(quoteResponse)} />
            <StatusRow icon={<Send />} label="Transaction" value={provisionalStatus ? 'Rechecking status' : status?.status ?? sponsorship?.status ?? 'Not submitted'} ok={Boolean(sponsorship) && !failed} />
          </div>
        </section> : null}

        <div className={embedded ? 'flex w-full' : 'mx-auto flex w-full max-w-lg'}>
          <Card size="sm" className={embedded ? 'w-full border-white/10 bg-card/45 shadow-none backdrop-blur-xl' : 'w-full'}>
            <CardContent>
              <form className={embedded ? 'grid gap-3' : 'grid gap-4'} onSubmit={event => { event.preventDefault(); void createQuote(); }}>
                <Tabs defaultValue="transfer" className={embedded ? 'gap-3' : 'gap-4'}>
                  {embedded ? (
                    <div className="relative flex items-center">
                      <h2 className="text-lg font-semibold tracking-tight">Transfer</h2>
                      <Badge variant="secondary" className="absolute left-1/2 -translate-x-1/2">Testnet</Badge>
                    </div>
                  ) : <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="transfer" className="cursor-pointer">Transfer</TabsTrigger>
                    <TabsTrigger value="advanced" className="cursor-pointer">Advanced</TabsTrigger>
                  </TabsList>}

                  <TabsContent value="transfer" className={embedded ? 'grid gap-3' : 'grid gap-4'}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-2 sm:col-span-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="amount">Amount</Label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="h-auto px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-primary hover:bg-primary/10 hover:text-primary"
                            onClick={setMaximumAmount}
                            disabled={!sbtcBalance || !/^\d+$/.test(sbtcBalance.balanceSats)}
                          >
                            MAX
                          </Button>
                        </div>
                        <div className="relative">
                          <Input id="amount" value={amountSats} onChange={event => setAmountSats(event.target.value)} inputMode="numeric" autoComplete="off" placeholder="0" className={`h-16 bg-transparent pr-14 text-3xl dark:bg-transparent md:text-3xl ${embedded ? 'focus-visible:border-input focus-visible:ring-0' : ''}`} />
                          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">sats</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 px-1 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Fee</span>
                            <span className="font-medium">{defaultSponsorFeeSats} sats</span>
                          </div>
                          <div className="flex items-center justify-between border-l border-border pl-4">
                            <span className="text-muted-foreground">Balance</span>
                            <span className="font-medium">{sbtcBalance ? `${sbtcBalance.balanceSats} sats` : origin ? 'Loading' : '—'}</span>
                          </div>
                        </div>
                      </div>
                      <div ref={recipientComboboxPortalRef} className="grid gap-2 sm:col-span-2 [container-type:inline-size]">
                        <Label htmlFor="recipient" className="justify-self-center">To</Label>
                        <Combobox
                          items={recentRecipients}
                          value={recipient || null}
                          inputValue={recipient}
                          onInputValueChange={value => setRecipient(value.trim())}
                          onValueChange={value => setRecipient(value ?? '')}
                        >
                          <ComboboxInput
                            id="recipient"
                            placeholder="ST…"
                            spellCheck={false}
                            autoCapitalize="characters"
                            autoComplete="off"
                            showClear={Boolean(recipient)}
                            className={`h-16 bg-transparent dark:bg-transparent [&_input]:font-mono [&_input]:!text-[clamp(0.6875rem,3.7cqw,1rem)] [&_input]:tracking-[-0.02em] ${embedded ? 'has-[[data-slot=input-group-control]:focus-visible]:border-input has-[[data-slot=input-group-control]:focus-visible]:ring-0' : ''}`}
                          />
                          <ComboboxContent portalContainer={recipientComboboxPortalRef}>
                            <ComboboxEmpty>No saved addresses</ComboboxEmpty>
                            <ComboboxList>
                              {recentRecipients.map(address => (
                                <ComboboxItem key={address} value={address} className="min-h-10 font-mono text-xs">
                                  <span className="truncate">{address}</span>
                                </ComboboxItem>
                              ))}
                            </ComboboxList>
                          </ComboboxContent>
                        </Combobox>
                      </div>
                      <Accordion type="single" collapsible className="sm:col-span-2">
                        <AccordionItem value="memo" className="rounded-lg border px-3">
                          <AccordionTrigger className="cursor-pointer py-3 text-sm">Add memo</AccordionTrigger>
                          <AccordionContent className="pb-3">
                            <div className="grid gap-2">
                              <Label htmlFor="memo">Memo text <span className="font-normal text-muted-foreground">(optional)</span></Label>
                              <Input id="memo" value={memo} onChange={event => setMemo(event.target.value)} placeholder="Add a short message…" autoComplete="off" className={`bg-transparent dark:bg-transparent ${embedded ? 'focus-visible:border-input focus-visible:ring-0' : ''}`} />
                              <p className={memoByteLength > 34 ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{memoByteLength}/34 bytes · converted to hex automatically</p>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </div>

                    {insufficientBalance ? (
                      <Alert variant="destructive"><CircleAlert /><AlertTitle>Insufficient sBTC balance</AlertTitle><AlertDescription>This transfer requires {estimatedTotalSats?.toString()} sats including the {defaultSponsorFeeSats} sat sponsor fee, but the wallet has {sbtcBalance?.balanceSats ?? '0'} sats.</AlertDescription></Alert>
                    ) : null}
                  </TabsContent>

                  {!embedded ? <TabsContent value="advanced">
                    <div className="grid gap-2 rounded-lg border p-4">
                      <Label htmlFor="relay-url">Relay endpoint</Label>
                      <div className="flex gap-2">
                        <Input id="relay-url" value={relayUrl} onChange={event => setRelayUrl(event.target.value)} className="font-mono text-xs" />
                        <Button type="button" variant="outline" onClick={loadRelay} disabled={Boolean(busy)}>
                          {busy === 'relay' ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">Change this only when connecting to a custom OSSR operator.</p>
                    </div>
                  </TabsContent> : null}
                </Tabs>

                {embedded && !origin ? (
                  <Button size="lg" type="button" onClick={() => void connectWallet()} disabled={Boolean(busy)} className="h-18 w-full text-lg">
                    {busy === 'wallet' ? <Loader2 className="animate-spin" /> : <Wallet />}
                    {busy === 'wallet' ? 'Connecting wallet…' : 'Connect wallet'}
                  </Button>
                ) : (
                  <Button size="lg" type="submit" disabled={!canQuote || Boolean(busy)} className="h-18 w-full text-lg">
                    {busy === 'quote' || busy === 'submit' ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                    {busy === 'quote' ? 'Preparing approval…' : busy === 'submit' ? 'Waiting for wallet…' : 'Continue in wallet'}
                  </Button>
                )}
              </form>
            </CardContent>
          </Card>

        </div>

        <Dialog open={transactionModalOpen} onOpenChange={setTransactionModalOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-xl" aria-describedby="transaction-modal-description">
            {status?.status === 'success' ? (
              <div className="grid place-items-center gap-5 px-6 pt-16 pb-8 text-center">
                <div className="grid size-20 place-items-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/25">
                  <CheckCircle2 className="size-11" strokeWidth={1.8} />
                </div>
                <DialogHeader className="items-center">
                  <DialogTitle className="text-2xl">Transaction successful</DialogTitle>
                  <DialogDescription id="transaction-modal-description">Your sponsored sBTC transfer has confirmed on Stacks testnet.</DialogDescription>
                </DialogHeader>
                <dl className="w-full rounded-lg border bg-muted/30 p-4 text-sm">
                  <ReviewRow label="Amount" value={`${amountSats} sats`} emphasized />
                  <ReviewRow label="Fee" value={`${quoteResponse?.quote.sponsorFee ?? '—'} sats`} />
                  <ReviewRow label="Transaction" valueNode={<TransactionId txid={txid} successful />} />
                  <ReviewRow label="Block height" value={status.blockHeight?.toString() ?? '—'} mono />
                </dl>
                <Button size="lg" className="h-10 w-full" onClick={resetForNewQuote}><CheckCircle2 /> Done</Button>
              </div>
            ) : (
              <>
                <DialogHeader className="border-b px-12 py-5 text-center sm:text-center">
                  <DialogTitle className="text-lg">Transaction submitted</DialogTitle>
                  <DialogDescription id="transaction-modal-description">
                    Your signed transaction is being confirmed on Stacks testnet.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-5 px-5 py-2 sm:px-6">
                  <div className="flex items-center justify-between rounded-lg border bg-primary/5 px-4 py-3">
                    <div><p className="text-xs text-muted-foreground">Amount</p><p className="mt-1 font-mono text-xl font-semibold">{amountSats} sats</p></div>
                    <Badge>{provisionalStatus ? 'Rechecking status' : status?.status ?? 'Broadcast'}</Badge>
                  </div>

                  <dl className="grid gap-2 rounded-lg border bg-muted/30 p-4 text-sm">
                    <ReviewRow label="Sponsor fee" value={quoteResponse ? `${quoteResponse.quote.sponsorFee} sats` : '—'} />
                    <ReviewRow label="Maximum outflow" value={totalSats ? `${totalSats} sats` : '—'} emphasized />
                    <Separator className="my-1" />
                    <ReviewRow label="To" value={compact(recipient, 10)} mono />
                    <ReviewRow label="Sponsor" value={quoteResponse ? compact(quoteResponse.quote.sponsorPrincipal, 10) : '—'} mono />
                    <ReviewRow label="Expires at block" value={quoteResponse?.quote.expiresAtBlock ?? '—'} mono />
                    <ReviewRow label="Transaction" valueNode={<TransactionId txid={txid} successful={false} />} />
                  </dl>

                  <div className="grid place-items-center gap-3 py-3 text-center">
                    {failed ? <CircleAlert className="size-10 text-destructive" /> : <Loader2 className="size-10 animate-spin text-primary" />}
                    <div>
                      <p className="font-medium">{failed ? 'Transaction failed' : provisionalStatus ? 'Rechecking chain status' : 'Waiting for confirmation'}</p>
                      {!provisionalStatus ? <p className="mt-1 text-xs text-muted-foreground">{describeChainStatus(status)}</p> : null}
                    </div>
                  </div>

                  {error ? <ErrorAlert error={error} /> : null}
                  {failed ? <TransactionOutcome status={status} txid={txid} failed amountSats={amountSats} sponsorFeeSats={quoteResponse?.quote.sponsorFee} origin={origin} /> : null}
                </div>

                <DialogFooter className="m-0 px-5 py-4 sm:px-6">
                  <Button variant="outline" size="lg" className="w-full" onClick={resetForNewQuote} disabled={Boolean(busy)}><RefreshCw /> New transfer</Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {error ? (
          <ErrorAlert error={error} className="mt-6" />
        ) : null}

        {!embedded ? <footer className="mt-8 flex flex-col gap-2 border-t border-border pt-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>OSSR v0.1 prototype · Testnet only · Do not use mainnet funds</span>
          <span>The relay pays STX. You authorize only the reviewed sBTC outflow.</span>
        </footer> : null}
      </div>
    </main>
  );
}

function ErrorAlert({ error, className }: { error: DisplayError; className?: string }) {
  const normalize = (value: string) => value.toLowerCase().replace(/^(this|the)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const showMessage = normalize(error.message) !== normalize(error.title);
  return (
    <Alert variant="destructive" className={className} aria-live="polite">
      <CircleAlert />
      <AlertTitle>{error.title}</AlertTitle>
      <AlertDescription className="grid gap-1.5">
        {showMessage ? <span>{error.message}</span> : null}
        {error.action ? <span className="font-medium">What to do: {error.action}</span> : null}
        {error.code ? <span className="font-mono text-[11px] opacity-75">{error.code}</span> : null}
      </AlertDescription>
    </Alert>
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
    <Alert variant={failed ? 'destructive' : 'default'} className={failed ? '' : 'border-primary/20 bg-primary/5'}>
      {failed ? <CircleAlert /> : <CheckCircle2 className="text-primary" />}
      <AlertTitle className="font-mono">{status?.status ?? 'BROADCAST'}</AlertTitle>
      <AlertDescription className="grid gap-3">
        <p>{describeChainStatus(status)}</p>
        <dl className="grid gap-2 text-xs">
          <ReviewRow label="Txid" valueNode={<TransactionId txid={txid} successful={status?.status === 'success'} />} />
          <ReviewRow label="Block height" value={status?.blockHeight?.toString() ?? '—'} mono />
          {adapterError ? <ReviewRow label="Adapter error" value={`${adapterError.name} (u${adapterError.code})`} mono /> : null}
          {requiredSats ? <ReviewRow label="Required sBTC" value={`${requiredSats} sats`} mono /> : null}
          {cause ? <ReviewRow label="Likely cause" value={cause} /> : null}
        </dl>
        {raw ? <details><summary className="cursor-pointer text-xs font-medium">Technical details</summary><pre className="mt-2 max-h-56 overflow-auto rounded-lg border bg-background p-3 font-mono text-[11px] text-foreground">{raw}</pre></details> : null}
      </AlertDescription>
    </Alert>
  );
}

function TransactionId({ txid, successful }: { txid?: string; successful: boolean }) {
  if (!txid) return '-';
  if (!successful) return txid;
  return (
    <a className="inline-flex items-center gap-1 font-mono text-primary underline-offset-4 hover:underline" href={hiroTxUrl(txid)} target="_blank" rel="noreferrer">
      {compact(txid, 12)} <ExternalLink className="size-3" />
    </a>
  );
}

function hiroTxUrl(txid: string): string {
  const normalized = txid.startsWith('0x') ? txid : `0x${txid}`;
  return `https://explorer.hiro.so/txid/${normalized}?chain=testnet`;
}

function StatusRow({ icon, label, value, ok }: { icon: React.ReactNode; label: string; value: string; ok: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border bg-card px-3 py-3 shadow-xs">
      <span className={ok ? 'text-primary [&_svg]:size-4' : 'text-muted-foreground [&_svg]:size-4'}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-xs font-medium">{value}</p>
      </div>
    </div>
  );
}

function ReviewRow({ label, value, valueNode, mono = false, emphasized = false }: {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
  mono?: boolean;
  emphasized?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] items-start gap-4 py-1">
      <dt className="text-right text-muted-foreground">{label}</dt>
      <dd className={`${mono ? 'font-mono text-xs' : ''} ${emphasized ? 'font-semibold text-foreground' : ''} min-w-0 [overflow-wrap:anywhere] text-left`}>
        {valueNode ?? value ?? '—'}
      </dd>
    </div>
  );
}

function compact(value: string, edge = 8): string {
  return value.length > edge * 2 + 1 ? `${value.slice(0, edge)}…${value.slice(-edge)}` : value;
}

function normalizeMemo(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function readAddresses(response: unknown): WalletAddress[] {
  if (!isRecord(response)) return [];
  const result = isRecord(response.result) ? response.result : response;
  return Array.isArray(result.addresses) ? result.addresses as WalletAddress[] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
