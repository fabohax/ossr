import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, ExternalLink, HeartPulse, KeyRound, Radio, Server, ShieldCheck } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Become an Operator — OSSR',
  description: 'Run an OSSR relay and prepare to register as an operator on the permissionless Stacks testnet registry.',
};

const requirements = [
  ['Sponsor wallet', 'A dedicated Stacks testnet account funded with enough STX to pay network fees.'],
  ['Isolated keys', 'Separate sponsor and quote-signing keys, stored outside the browser-facing application.'],
  ['Simulation node', 'Access to a Stacks Core 4.0.3+ simulation endpoint so unsafe transactions fail before signing.'],
  ['Public endpoint', 'A stable HTTPS relay URL exposing OSSR v1 info, quote, sponsorship, status, and readiness endpoints.'],
];

const registrationFields = [
  'Owner principal and quote public key',
  'Minimum locked STX collateral',
  'Metadata URI and content hash',
  'Supported OSSR protocol versions',
  'Network, action, adapter, and reimbursement capabilities',
  'Advertised pricing and sponsorship capacity',
];

export default function OperatorsPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[34rem] bg-[radial-gradient(circle_at_50%_0%,rgba(53,211,150,0.16),transparent_62%)]" aria-hidden="true" />

      <header className="relative z-10 mx-auto flex h-20 w-[calc(100%_-_3rem)] max-w-[1180px] items-center justify-between border-b border-white/10">
        <Link href="/" className="text-lg font-bold tracking-tight" aria-label="OSSR home">OSSR</Link>
        <nav className="flex items-center gap-5 text-xs text-muted-foreground" aria-label="Operator navigation">
          <Link href="/" className="transition-colors hover:text-foreground">PROTOCOL</Link>
          <a href="https://github.com/OSSR-protocol" className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground">GITHUB <ExternalLink className="size-3" /></a>
        </nav>
      </header>

      <section className="relative mx-auto grid w-[calc(100%_-_3rem)] max-w-[1180px] gap-10 py-20 lg:grid-cols-[1.1fr_.9fr] lg:items-end lg:py-28">
        <div>
          <span className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">TESTNET OPERATOR GUIDE</span>
          <h1 className="mt-5 max-w-4xl text-5xl leading-[0.98] font-semibold tracking-[-0.045em] sm:text-6xl lg:text-7xl">Run a relay.<br /><span className="text-primary">Join the open network.</span></h1>
          <p className="mt-7 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">Operators keep OSSR available by validating transactions, paying Stacks network fees, and broadcasting safely. Registration is permissionless: no administrator chooses who may participate.</p>
        </div>
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <h2 className="font-medium">Registry deployment is not live yet</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">The version 1 registry and lifecycle are specified, but the final Clarity ABI and deployed contract are still pending. You can run and harden a relay today, then register once the contract address and parameters are published.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[0.02]">
        <div className="mx-auto w-[calc(100%_-_3rem)] max-w-[1180px] py-20">
          <div className="max-w-2xl">
            <span className="font-mono text-[10px] font-semibold tracking-[0.18em] text-primary">BEFORE YOU REGISTER</span>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.03em]">Prepare a production-minded relay.</h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {requirements.map(([title, description], index) => {
              const Icon = [Server, KeyRound, ShieldCheck, Radio][index];
              return <article key={title} className="rounded-2xl border border-white/10 bg-card/60 p-6">
                <Icon className="size-5 text-primary" />
                <h3 className="mt-8 font-medium">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
              </article>;
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto w-[calc(100%_-_3rem)] max-w-[1180px] py-20 lg:py-28">
        <span className="font-mono text-[10px] font-semibold tracking-[0.18em] text-primary">OPERATOR PATH</span>
        <h2 className="mt-4 max-w-2xl text-4xl font-semibold tracking-[-0.03em]">From local relay to discoverable operator.</h2>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10">
          <Step number="01" title="Configure your relay">
            Copy the environment template, set dedicated testnet sponsor and quote keys, pin the approved adapter and sBTC contracts, and configure a Stacks API plus simulation endpoint.
            <Code>npm run operator:serve</Code>
          </Step>
          <Step number="02" title="Prove readiness">
            Confirm the public metadata and readiness endpoints return your intended relay identity, sponsor principal, quote key, policy, and a healthy STX balance.
            <Code>{`curl -fsS https://relay.example/v1/info\ncurl -fsS https://relay.example/health/ready`}</Code>
          </Step>
          <Step number="03" title="Publish verified metadata">
            Host a bounded metadata document over HTTPS or content-addressed storage. It should identify your operator, API URL, region, description, website, and support channels. Keep its content hash ready for registration.
          </Step>
          <Step number="04" title="Register on-chain">
            When the registry deploys, call its registration function from the owner principal and lock at least the published minimum collateral. Registration becomes active only after all required fields and capabilities validate.
            <ul className="mt-5 grid gap-2 sm:grid-cols-2">
              {registrationFields.map(field => <li key={field} className="flex items-start gap-2 text-sm text-muted-foreground"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />{field}</li>)}
            </ul>
          </Step>
          <Step number="05" title="Stay active">
            Submit owner-authorized heartbeats, keep collateral above the minimum, maintain accurate pricing and capabilities, rotate quote keys visibly, and keep the HTTPS relay healthy. Stale or inactive operators are excluded from discovery.
            <div className="mt-5 inline-flex items-center gap-2 text-sm text-primary"><HeartPulse className="size-4" /> Recommended heartbeat window: 500 blocks</div>
          </Step>
        </div>
      </section>

      <section className="mx-auto mb-24 grid w-[calc(100%_-_3rem)] max-w-[1180px] gap-8 rounded-3xl border border-primary/20 bg-primary/[0.06] p-8 sm:p-12 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <h2 className="text-3xl font-semibold tracking-[-0.03em]">Start operating on testnet.</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Review the implementation, follow deployment progress, and contribute to the registry contract in the official OSSR repository.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/" className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 px-5 text-sm font-medium transition-colors hover:bg-white/5"><ArrowLeft className="size-4" /> Back home</Link>
          <a href="https://github.com/OSSR-protocol" className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-85">View on GitHub <ArrowRight className="size-4" /></a>
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

function Code({ children }: { children: React.ReactNode }) {
  return <pre className="mt-5 overflow-x-auto rounded-xl border border-white/10 bg-black/30 p-4 font-mono text-xs leading-6 text-foreground"><code>{children}</code></pre>;
}
