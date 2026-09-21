import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Braces, Code2, ExternalLink, FileKey2, Radio, ShieldCheck, WalletCards } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Developer Integration — OSSR',
  description: 'Integrate sponsored sBTC transfers into a Stacks dapp with the OSSR relay API and a compatible browser wallet.',
};

const endpoints = [
  ['GET', '/v1/info', 'Read relay identity, contracts, limits, and quote keys.'],
  ['POST', '/v1/quotes', 'Request a signed, expiring offer for one exact transfer.'],
  ['POST', '/v1/sponsorships', 'Submit the origin-signed transaction for sponsorship and broadcast.'],
  ['GET', '/v1/sponsorships/{txid}', 'Track relay and observed Stacks chain status.'],
];

const safeguards = [
  { title: 'Never handle keys', description: 'Use an installed wallet. Your dapp must never request or transmit seed phrases or private keys.', icon: WalletCards },
  { title: 'Bind the exact intent', description: 'Amount, recipient, sponsor fee, adapter, expiry, and quote ID must match the signed quote.', icon: FileKey2 },
  { title: 'Fail closed', description: 'Reject unknown networks, contracts, quote keys, protocol versions, and malformed relay responses.', icon: ShieldCheck },
  { title: 'Submit once', description: 'Send an origin-signed transaction to only its quoted relay and use the quote ID as the idempotency boundary.', icon: Radio },
];

export default function DevelopersPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[36rem] bg-[radial-gradient(circle_at_50%_0%,rgba(53,211,150,0.16),transparent_62%)]" aria-hidden="true" />
      <header className="relative z-10 mx-auto flex h-20 w-[calc(100%_-_3rem)] max-w-[1180px] items-center justify-between border-b border-white/10">
        <Link href="/" className="text-lg font-bold tracking-tight" aria-label="OSSR home">OSSR</Link>
        <nav className="flex items-center gap-5 text-xs text-muted-foreground" aria-label="Developer navigation">
          <Link href="/" className="transition-colors hover:text-foreground">PROTOCOL</Link>
          <Link href="/operators" className="transition-colors hover:text-foreground">OPERATORS</Link>
          <a href="https://github.com/OSSR-protocol" className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground">GITHUB <ExternalLink className="size-3" /></a>
        </nav>
      </header>

      <section className="relative mx-auto grid w-[calc(100%_-_3rem)] max-w-[1180px] gap-12 py-20 lg:grid-cols-[1fr_.9fr] lg:items-center lg:py-28">
        <div>
          <span className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">DAPP INTEGRATION GUIDE</span>
          <h1 className="mt-5 max-w-3xl text-5xl leading-[0.98] font-semibold tracking-[-0.045em] sm:text-6xl lg:text-7xl">Make sBTC transfers<br /><span className="text-primary">feel gasless.</span></h1>
          <p className="mt-7 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">OSSR lets your users authorize one exact sBTC transfer while an independent relay supplies the STX network fee, signs as sponsor, and broadcasts the completed transaction.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/" className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-85">Try the interface <ArrowRight className="size-4" /></Link>
            <a href="https://github.com/OSSR-protocol" className="inline-flex h-11 items-center gap-2 rounded-full border border-white/15 px-6 text-sm font-medium transition-colors hover:bg-white/5">Explore the source <ExternalLink className="size-4" /></a>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30 shadow-2xl">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 font-mono text-[10px] text-muted-foreground"><Braces className="size-3.5 text-primary" /> sponsored-transfer.ts</div>
          <pre className="overflow-x-auto p-5 font-mono text-xs leading-6 text-muted-foreground"><code><span className="text-primary">const</span> quote = <span className="text-primary">await</span> requestQuote({'{'}{`\n  relayUrl, origin, recipient,\n  amountSats: "1000",\n  maxSponsorFeeSats: "20",\n`}{'}'});{`\n\n`}<span className="text-primary">const</span> call = prepareWalletContractCall({'{'}{`\n  quote: quote.quote,\n  recipient, amountSats: "1000",\n`}{'}'});{`\n\n`}<span className="text-primary">const</span> signed = <span className="text-primary">await</span> request({`\n  "stx_callContract",\n`}{'  {'}{` ...call, network: "testnet" `}{'}'}{`\n`});</code></pre>
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[0.02]">
        <div className="mx-auto w-[calc(100%_-_3rem)] max-w-[1180px] py-20">
          <span className="font-mono text-[10px] font-semibold tracking-[0.18em] text-primary">THE INTEGRATION FLOW</span>
          <h2 className="mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.03em]">One user approval. Six verifiable steps.</h2>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10">
            <Step number="01" title="Load trusted relay metadata">Fetch <CodeInline>GET /v1/info</CodeInline>. Pin or validate the relay ID, testnet network, sponsor principal, adapter contract, sBTC contract, limits, and active quote public key.</Step>
            <Step number="02" title="Request an exact quote">Send the origin, recipient, amount in sats, maximum acceptable sponsor fee, and optional memo to <CodeInline>POST /v1/quotes</CodeInline>. Display the returned fee, expiry, and maximum token outflow.</Step>
            <Step number="03" title="Build the adapter call">Construct the allowlisted <CodeInline>sponsored-transfer</CodeInline> call and an exact-deny sBTC post-condition for <CodeInline>amount + sponsorFee</CodeInline>. Do not permit arbitrary contract calls.</Step>
            <Step number="04" title="Ask the wallet to approve">Use a compatible wallet’s <CodeInline>stx_callContract</CodeInline> request with <CodeInline>sponsored: true</CodeInline>. The wallet signs only the origin authorization and returns raw transaction bytes without broadcasting.</Step>
            <Step number="05" title="Submit to the quoted relay">POST the quote ID, raw origin-signed transaction, and origin principal to <CodeInline>/v1/sponsorships</CodeInline>. The relay validates, simulates, adds its sponsor authorization, and broadcasts.</Step>
            <Step number="06" title="Track the outcome">Poll the returned transaction ID until a terminal status. Treat chain success as completion; surface post-condition aborts, contract errors, dropped transactions, and quote expiry distinctly.</Step>
          </div>
        </div>
      </section>

      <section className="mx-auto w-[calc(100%_-_3rem)] max-w-[1180px] py-20 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-[.75fr_1.25fr]">
          <div>
            <span className="font-mono text-[10px] font-semibold tracking-[0.18em] text-primary">RELAY API</span>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.03em]">A deliberately narrow surface.</h2>
            <p className="mt-5 text-sm leading-6 text-muted-foreground">Version 1 is testnet-only and supports the reviewed sBTC transfer adapter. Public deployments must use HTTPS and an explicit browser-origin allowlist.</p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10">
            {endpoints.map(([method, path, description]) => <article key={path} className="grid gap-2 border-b border-white/10 p-5 last:border-0 sm:grid-cols-[4rem_1fr]">
              <span className="font-mono text-xs font-semibold text-primary">{method}</span>
              <div><code className="font-mono text-sm text-foreground">{path}</code><p className="mt-1.5 text-sm leading-6 text-muted-foreground">{description}</p></div>
            </article>)}
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[0.02]">
        <div className="mx-auto w-[calc(100%_-_3rem)] max-w-[1180px] py-20">
          <span className="font-mono text-[10px] font-semibold tracking-[0.18em] text-primary">SECURITY INVARIANTS</span>
          <h2 className="mt-4 text-4xl font-semibold tracking-[-0.03em]">Keep the wallet in control.</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {safeguards.map(({ title, description, icon: Icon }) => <article key={title} className="rounded-2xl border border-white/10 bg-card/60 p-6">
              <Icon className="size-5 text-primary" />
              <h3 className="mt-8 font-medium">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
            </article>)}
          </div>
        </div>
      </section>

      <section className="mx-auto my-24 grid w-[calc(100%_-_3rem)] max-w-[1180px] gap-8 rounded-3xl border border-primary/20 bg-primary/[0.06] p-8 sm:p-12 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <h2 className="text-3xl font-semibold tracking-[-0.03em]">Build against the reference flow.</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">The current repository contains working quote, wallet-call, submission, and status helpers. Treat them as reference implementation code while the public SDK and API remain draft.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/" className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 px-5 text-sm font-medium transition-colors hover:bg-white/5"><ArrowLeft className="size-4" /> Back home</Link>
          <a href="https://github.com/OSSR-protocol" className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-85">View integration code <Code2 className="size-4" /></a>
        </div>
      </section>
    </main>
  );
}

function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <article className="grid gap-5 bg-background p-6 sm:grid-cols-[3rem_1fr] sm:p-8">
    <span className="font-mono text-xs text-primary">{number}</span>
    <div><h3 className="text-xl font-medium">{title}</h3><div className="mt-3 text-sm leading-6 text-muted-foreground">{children}</div></div>
  </article>;
}

function CodeInline({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.8em] text-foreground">{children}</code>;
}
