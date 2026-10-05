import { fetchSbtcBalance, type SbtcBalance } from './ossr';

export const defaultSbtcContract = 'SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token';
const balances = new Map<string, { value: SbtcBalance; fetchedAt: number }>();
const pending = new Map<string, Promise<SbtcBalance>>();
const freshMs = 10_000;
const displayMs = 5 * 60_000;
function balanceKey(address: string, contract: string) { return `${address}:${contract}`; }

export function cachedSbtcBalance(address: string, contract = defaultSbtcContract): SbtcBalance | undefined {
  const cached = balances.get(balanceKey(address, contract));
  return cached && Date.now() - cached.fetchedAt < displayMs ? cached.value : undefined;
}

// This cache is for display only. Signing checks call fetchSbtcBalance directly.
export function fetchDisplaySbtcBalance(address: string, contract = defaultSbtcContract): Promise<SbtcBalance> {
  const key = balanceKey(address, contract);
  const cached = balances.get(key);
  if (cached && Date.now() - cached.fetchedAt < freshMs) return Promise.resolve(cached.value);
  const existing = pending.get(key);
  if (existing) return existing;
  const operation = fetchSbtcBalance(address, contract).then(value => {
    balances.set(key, { value, fetchedAt: Date.now() });
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, operation);
  return operation;
}

export function prefetchSbtcBalance(address: string) {
  if (!/^(ST|SN)/.test(address)) return;
  void fetchDisplaySbtcBalance(address, process.env.NEXT_PUBLIC_OSSR_SBTC_CONTRACT || defaultSbtcContract).catch(() => undefined);
}
