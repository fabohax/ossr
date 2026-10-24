'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Check, ChevronRight, Code2, Github, Server, TerminalSquare, Users } from 'lucide-react';
import { Layer, Wallet } from 'iconsax-reactjs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { connectTestnetWallet } from '@/lib/connect-wallet';
import { prefetchSbtcBalance } from '@/lib/sbtc-balance';
import { connectedWalletPublicKeyKey, requireTestnetStacksAccount } from '@/lib/stacks-wallet';
import Dashboard from './dashboard/page';
import styles from './page.module.css';
import { nostrProfileUrl } from '@/lib/social';

const steps = [
  ['01', 'Request a quote', 'A wallet asks the relay for a bounded sponsorship quote, including fees and expiry.'],
  ['02', 'Sign once', 'The user authorizes the exact token movement—without ever needing to hold STX.'],
  ['03', 'Relay atomically', 'An operator sponsors and broadcasts the transaction, settling its fee in the same flow.'],
];

const principles = [
  { icon: '/lock.svg', title: 'Non-custodial', copy: 'Users sign their own intent. Operators sponsor execution, but never control user funds.' },
  { icon: '/network.svg', title: 'Open operator network', copy: 'A permissionless relay layer designed for resilient routing and transparent competition.' },
  { icon: '/flash.svg', title: 'One seamless action', copy: 'Fees are handled behind the scenes, making Stacks applications feel fast and familiar.' },
];

const connectedAddressKey = 'ossr-ui:connected-stx-address';

function compactAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 5)}…${address.slice(-4)}` : address;
}

export default function Home() {
  const [transferOpen, setTransferOpen] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState('');
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [walletError, setWalletError] = useState('');

  useEffect(() => {
    const address = window.localStorage.getItem(connectedAddressKey) ?? '';
    setConnectedAddress(address);
    prefetchSbtcBalance(address);
  }, []);

  async function disconnectWallet() {
    const { disconnect } = await import('@stacks/connect');
    disconnect();
    window.localStorage.removeItem(connectedAddressKey);
    window.localStorage.removeItem(connectedWalletPublicKeyKey);
    setConnectedAddress('');
    setTransferOpen(false);
  }

  async function handleWalletButton() {
    if (connectedAddress) {
      setTransferOpen(true);
      return;
    }
    setConnectingWallet(true);
    setWalletError('');
    try {
      const response = await connectTestnetWallet();
      const account = requireTestnetStacksAccount(response);
      window.localStorage.setItem(connectedAddressKey, account.address);
      if (account.publicKey) window.localStorage.setItem(connectedWalletPublicKeyKey, account.publicKey);
      else window.localStorage.removeItem(connectedWalletPublicKeyKey);
      setConnectedAddress(account.address);
      setTransferOpen(true);
    } catch (caught) {
      setWalletError(caught instanceof Error ? caught.message : 'The wallet could not be connected.');
    } finally {
      setConnectingWallet(false);
    }
  }

  return <main className={styles.page}>
    <div className={styles.ambient} aria-hidden="true" />
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="OSSR home"><Image src="/ossr-logo-120.png" alt="OSSR" width={60} height={24} /></Link>
      <nav className={styles.nav} aria-label="Primary navigation"><Link href="/docs">DOCS</Link><Link href="/docs/x402">x402</Link><Link href="/operators">OPERATORS</Link><Link href="/developers">DEVELOPERS</Link></nav>
      <div className={`${styles.walletControls} relative`}>
        {connectedAddress ? (
          <Button variant="ghost" size="icon" className={styles.disconnect} onClick={() => void disconnectWallet()} aria-label="Disconnect wallet" title="Disconnect wallet">
            <Image src="/sign-out.svg" alt="" width={19} height={19} />
          </Button>
        ) : null}
        <Button className={`${styles.connect} ${connectedAddress ? styles.connected : styles.walletPrompt}`} onClick={() => void handleWalletButton()} disabled={connectingWallet}>
          <Image src="/wallet.svg" alt="" width={18} height={18} className={styles.walletIcon} />
          {connectedAddress ? compactAddress(connectedAddress) : connectingWallet ? 'Connecting…' : 'Connect Wallet'}
        </Button>
        {walletError ? <p className="absolute top-[calc(100%+8px)] right-0 w-max max-w-70 text-right text-xs leading-5 text-red-300" role="alert">{walletError}</p> : null}
      </div>
    </header>

    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <div className={styles.eyebrow}><Image src="/stacks-white.svg" alt="" width={14} height={14} /> Open infrastructure for Stacks</div>
        <h1>Transactions should feel <span>effortless.</span></h1>
        <p className={styles.lede}>OSSR is an open protocol for sponsored Stacks transactions. Users move sBTC without holding STX, while independent operators handle network fees.</p>
        <div className={styles.heroActions}>
          <Button asChild size="lg" className={styles.primary}><Link href="/dashboard">Open dashboard <ArrowRight /></Link></Button>
          <Button asChild size="lg" variant="outline" className={styles.secondary}><Link href="/docs">Explore the protocol <ChevronRight /></Link></Button>
        </div>
        <div className={styles.trust}><span><Check /> Non-custodial</span><span><Check /> Open source</span><span><Check /> Built for Bitcoin</span></div>
      </div>
      <div className={styles.visual} aria-label="How a sponsored Stacks transaction works">
        <div className={styles.glow} />
        <div className={styles.flowStages}>
          <article className={styles.stage}><div className={styles.stageIcon}><Wallet size={24} variant="Linear" /></div><span className={styles.stageNumber}>01</span><h3>User</h3><p>Signs the sBTC transfer</p></article>
          <ArrowRight className={styles.stageArrow} aria-hidden="true" />
          <article className={styles.stage}><div className={styles.stageIcon}><Server size={24} /></div><span className={styles.stageNumber}>02</span><h3>Operator</h3><p>Pays the fee and broadcasts</p></article>
          <ArrowRight className={styles.stageArrow} aria-hidden="true" />
          <article className={styles.stage}><div className={styles.stageIcon}><Layer size={24} variant="Linear" /></div><span className={styles.stageNumber}>03</span><h3>Stacks chain</h3><p>Confirms the transaction</p></article>
        </div>
        <p className={styles.flowCaption}>The user signs once. The operator covers the network fee.</p>
      </div>
    </section>

    <section className={styles.stats} aria-label="Protocol characteristics">
      <div><strong>0 STX</strong><span>required by users</span></div><div><strong>1 signature</strong><span>from intent to settlement</span></div><div><strong>100%</strong><span>non-custodial by design</span></div><div><strong>Open</strong><span>protocol and operator network</span></div>
    </section>

    <section id="documentation" className={styles.section}>
      <div className={styles.intro}><span className={styles.kicker}>THE PROTOCOL</span><h2>A better transaction primitive.</h2><p>OSSR separates user intent from fee payment, letting applications deliver gasless experiences without compromising ownership.</p></div>
      <div className={styles.principles}>{principles.map(({icon,title,copy}) => <article key={title} className={styles.principle}><div className={styles.cardIcon}><Image src={icon} alt="" width={30} height={30} /></div><h3>{title}</h3><p>{copy}</p></article>)}</div>
    </section>

    <section className={styles.how}>
      <div className={styles.howHeader}><div><span className={styles.kicker}>HOW IT WORKS</span><h2>Simple for users.<br />Powerful underneath.</h2></div><p>A compact, verifiable flow connects wallets, relay operators, and the Stacks network.</p></div>
      <div className={styles.steps}>{steps.map(([number,title,copy], index) => <article key={number} className={styles.step}><span>{number}</span><div><Image src={index === 0 ? '/quote.svg' : index === 1 ? '/sign.svg' : '/send-bitcoin.svg'} alt="" width={28} height={28} /></div><h3>{title}</h3><p>{copy}</p></article>)}</div>
    </section>

    <section className={styles.paths}>
      <article id="operators" className={styles.path}><div className={styles.cardIcon}><Users /></div><span className={styles.kicker}>FOR OPERATORS</span><h2>Power the relay network.</h2><p>Run infrastructure, sponsor transactions, and help create a more accessible Stacks ecosystem.</p><Link href="/operators">Operator overview <ArrowRight /></Link><div className={styles.terminal}><div><i/><i/><i/><span>operator</span></div><code><b>$</b> ossr-operator start</code><code><em>✓</em> connected to stacks-testnet</code><code><em>✓</em> relay ready for quotes</code></div></article>
      <article id="developers" className={styles.path}><div className={styles.cardIcon}><Code2 /></div><span className={styles.kicker}>FOR DEVELOPERS</span><h2>Make gasless feel native.</h2><p>Integrate sponsored sBTC transfers with a small, predictable API designed for modern applications.</p><Link href="/developers">Read the docs <ArrowRight /></Link><div className={styles.code}><div><TerminalSquare /><span>request.ts</span></div><pre><span>const</span> quote = <span>await</span> ossr.quote({'{'}{`\n  amount: 1000,\n  token: 'sBTC'\n`}{'}'});</pre></div></article>
    </section>

    <section className={styles.final}><span className={styles.kicker}>READY TO GET STARTED?</span><h2>The open relay layer for Stacks.</h2><p>Connect your wallet and experience sponsored transactions on testnet.</p><Button size="lg" className={styles.primary} onClick={() => setTransferOpen(true)}>Connect to OSSR <ArrowRight /></Button></section>
    <footer className={styles.footer}><div className={styles.brand}><Image src="/ossr-logo-120.png" alt="OSSR" width={60} height={24} /></div><p>Open Stacks Sponsor Relay. Built for the Plebs.</p><div><Link href="/docs">Protocol</Link><Link href="/operators">Operators</Link><Link href="/developers">Developers</Link><a href={nostrProfileUrl} aria-label="OSSR on Nostr" className={styles.nostrLink}>Nostr</a><a href="https://github.com/ossr-protocol" aria-label="OSSR Protocol on GitHub"><Github /></a></div></footer>

    <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
      <DialogContent className="w-[min(26.5rem,calc(100vw-1rem))] max-h-[calc(100vh-2rem)] max-w-none overflow-y-auto border-white/15 bg-background/65 p-0 shadow-2xl backdrop-blur-2xl sm:max-w-none">
        <DialogHeader className="sr-only">
          <DialogTitle>Sponsored sBTC transfer</DialogTitle>
          <DialogDescription>Connect a wallet, request a quote, and approve the sponsored transaction.</DialogDescription>
        </DialogHeader>
        <Dashboard embedded onWalletChange={setConnectedAddress} />
      </DialogContent>
    </Dialog>
  </main>;
}

