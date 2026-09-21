'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { bufferCV, Pc, stringAsciiCV } from '@stacks/transactions';
import { CheckCircle2, CircleAlert, ExternalLink, Loader2, Wallet } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { enableDarkStacksWalletSelector } from '@/lib/stacks-wallet-theme';

const contractAddress = process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS
  ?? 'ST2SY3PZHMVQMYN1W4SBJ9MPHW4P8J01ST7TVQ68X';
const contractName = process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_NAME ?? 'operators-registry-v7';
const contractId = `${contractAddress}.${contractName}` as `${string}.${string}`;
const subscriptionFeeMicroStx = 10_000_000n;
const connectedAddressKey = 'ossr-ui:connected-stx-address';

type WalletAddress = { symbol?: string; address?: string; publicKey?: string };

export function OperatorRegistration() {
  const [address, setAddress] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [busy, setBusy] = useState<'connect' | 'register'>();
  const [error, setError] = useState('');
  const [txid, setTxid] = useState('');

  useEffect(() => {
    setAddress(window.localStorage.getItem(connectedAddressKey) ?? '');
  }, []);

  async function connectWallet() {
    setBusy('connect');
    setError('');
    try {
      const { connect } = await import('@stacks/connect');
      const stopWalletThemeObserver = enableDarkStacksWalletSelector();
      const response = await connect({ forceWalletSelect: true }).finally(stopWalletThemeObserver);
      const addresses = readAddresses(response);
      const stx = addresses.find(item => item.symbol === 'STX' && item.address);
      if (!stx?.address) throw new Error('The wallet did not return a Stacks address.');
      setAddress(stx.address);
      window.localStorage.setItem(connectedAddressKey, stx.address);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(undefined);
    }
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setTxid('');

    const normalizedId = operatorId.trim();
    const normalizedKey = publicKey.trim().replace(/^0x/i, '');
    const normalizedEndpoint = endpoint.trim();
    if (!address) return setError('Connect the owner wallet before registering.');
    if (!isAscii(normalizedId) || normalizedId.length < 1 || normalizedId.length > 64) return setError('Operator ID must be 1–64 ASCII characters.');
    if (!/^(02|03)[0-9a-fA-F]{64}$/.test(normalizedKey)) return setError('Quote public key must be a 33-byte compressed secp256k1 key (66 hex characters starting with 02 or 03).');
    if (!isAscii(normalizedEndpoint) || normalizedEndpoint.length > 256) return setError('Relay endpoint must be no more than 256 ASCII characters.');
    try {
      const url = new URL(normalizedEndpoint);
      if (url.protocol !== 'https:') throw new Error();
    } catch {
      return setError('Relay endpoint must be a valid HTTPS URL.');
    }

    setBusy('register');
    try {
      const { request } = await import('@stacks/connect');
      const result = await request('stx_callContract', {
        address: address as `S${string}`,
        contract: contractId,
        functionName: 'register',
        functionArgs: [
          stringAsciiCV(normalizedId),
          bufferCV(Uint8Array.from(normalizedKey.match(/.{2}/g)!.map(byte => Number.parseInt(byte, 16)))),
          stringAsciiCV(normalizedEndpoint),
        ],
        network: 'testnet',
        postConditionMode: 'deny',
        postConditions: [Pc.origin().willSendEq(subscriptionFeeMicroStx).ustx()],
      });
      const submittedTxid = readTxid(result);
      if (!submittedTxid) throw new Error('The wallet did not return a transaction ID.');
      setTxid(submittedTxid);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Card className="border-primary/20 bg-card/80">
      <CardHeader className="border-b border-white/10 pb-5">
        <CardTitle className="text-xl">Register your relay</CardTitle>
        <CardDescription>Publish your operator record on Stacks testnet. The contract charges exactly 10 STX.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" onSubmit={register}>
          <div className="grid gap-2">
            <Label htmlFor="operator-id">Operator ID</Label>
            <Input id="operator-id" value={operatorId} onChange={event => setOperatorId(event.target.value)} maxLength={64} placeholder="relay-lima-01" disabled={Boolean(busy)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="quote-public-key">Quote-signing public key</Label>
            <Input id="quote-public-key" value={publicKey} onChange={event => setPublicKey(event.target.value)} spellCheck={false} autoComplete="off" placeholder="02… (66 hex characters)" className="font-mono" disabled={Boolean(busy)} />
            <p className="text-xs leading-5 text-muted-foreground">Use the compressed public key for your isolated quote signer, not a private key.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="relay-endpoint">Relay endpoint</Label>
            <Input id="relay-endpoint" type="url" value={endpoint} onChange={event => setEndpoint(event.target.value)} maxLength={256} placeholder="https://relay.example/v1" disabled={Boolean(busy)} />
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Owner</span><span className="max-w-[65%] truncate font-mono text-xs">{address || 'Not connected'}</span></div>
            <div className="mt-2 flex justify-between gap-4"><span className="text-muted-foreground">Registration</span><span className="font-medium">10 STX + network fee</span></div>
            <div className="mt-2 flex justify-between gap-4"><span className="text-muted-foreground">Network</span><span>Stacks testnet</span></div>
          </div>

          {error && <Alert variant="destructive"><CircleAlert /><AlertTitle>Registration could not continue</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
          {txid && <Alert className="border-primary/30"><CheckCircle2 className="text-primary" /><AlertTitle>Registration submitted</AlertTitle><AlertDescription><a href={`https://explorer.hiro.so/txid/0x${txid.replace(/^0x/, '')}?chain=testnet`} target="_blank" rel="noreferrer">Track transaction <ExternalLink className="ml-1 inline size-3" /></a></AlertDescription></Alert>}

          {address ? (
            <Button type="submit" size="lg" className="h-11" disabled={Boolean(busy)}>
              {busy === 'register' ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
              {busy === 'register' ? 'Waiting for wallet…' : 'Review and register for 10 STX'}
            </Button>
          ) : (
            <Button type="button" size="lg" className="h-11" onClick={() => void connectWallet()} disabled={Boolean(busy)}>
              {busy === 'connect' ? <Loader2 className="animate-spin" /> : <Wallet />}
              {busy === 'connect' ? 'Connecting…' : 'Connect owner wallet'}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function isAscii(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value);
}

function readAddresses(response: unknown): WalletAddress[] {
  if (!isRecord(response)) return [];
  const result = isRecord(response.result) ? response.result : response;
  return Array.isArray(result.addresses) ? result.addresses as WalletAddress[] : [];
}

function readTxid(response: unknown): string {
  if (!isRecord(response)) return '';
  const result = isRecord(response.result) ? response.result : response;
  return typeof result.txid === 'string' ? result.txid : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageFrom(value: unknown): string {
  return value instanceof Error ? value.message : 'The wallet rejected or could not submit the transaction.';
}
