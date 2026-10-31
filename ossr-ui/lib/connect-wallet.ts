import { DEFAULT_PROVIDERS, request, setSelectedProviderId, type StacksProvider } from '@stacks/connect';
import { getInstalledProviders, getProviderFromId } from '@stacks/connect-ui';
import { defineCustomElements } from '@stacks/connect-ui/loader';
import { approvedWalletProviderIds, requireStacksAccount } from './stacks-wallet';
import { enableDarkStacksWalletSelector } from './stacks-wallet-theme';
import { prefetchSbtcBalance } from './sbtc-balance';
import { stacksNetwork, type StacksNetworkName } from './network';

type WalletProvider = { request(method: string, params: Record<string, unknown>): Promise<unknown> };

export function walletConnectionRequest(providerId: string, network: StacksNetworkName = stacksNetwork) {
  const walletNetwork = network === 'mainnet' ? 'Mainnet' : 'Testnet';
  return providerId === 'XverseProviders.BitcoinProvider'
    ? { method: 'wallet_connect', params: { network: walletNetwork, addresses: ['stacks'], message: `Connect to OSSR on Stacks ${network}` } }
    : { method: 'stx_getAddresses', params: { network } };
}

export async function withWalletTimeout<T>(operation: Promise<T>, timeoutMs = 60_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('The wallet did not respond. Open or unlock Xverse or Leather, dismiss any pending request, then try connecting again.')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export async function requestStacksWalletAccounts(providerId: string, provider: WalletProvider, timeoutMs = 60_000, network: StacksNetworkName = stacksNetwork) {
  const connection = walletConnectionRequest(providerId, network);
  // Route by the selected provider ID, not Connect's legacy feature detection.
  // Bound the raw request so a late wallet response cannot update Connect's cache.
  const adapter = {
    request: async () => {
      const result = await withWalletTimeout(provider.request(connection.method, connection.params), timeoutMs);
      if (result && typeof result === 'object' && !('error' in result)) requireStacksAccount(result, network);
      return result;
    },
  } as unknown as StacksProvider;
  const response = await request({ provider: adapter, enableOverrides: false }, 'getAddresses');
  requireStacksAccount(response, network);
  return response;
}

export async function connectStacksWallet(network: StacksNetworkName = stacksNetwork) {
  await defineCustomElements(window);
  const stopTheme = enableDarkStacksWalletSelector();
  const modal = document.createElement('connect-modal');
  const allowed = DEFAULT_PROVIDERS.filter(provider => approvedWalletProviderIds.includes(provider.id));
  modal.defaultProviders = allowed;
  modal.installedProviders = getInstalledProviders(allowed).filter(provider => approvedWalletProviderIds.includes(provider.id));
  const overflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  let timer: ReturnType<typeof setTimeout>;
  let onEscape: (event: KeyboardEvent) => void;
  const cleanup = () => {
    clearTimeout(timer);
    document.removeEventListener('keydown', onEscape);
    modal.remove();
    document.body.style.overflow = overflow;
    stopTheme();
  };
  const providerId = await new Promise<string>((resolve, reject) => {
    const cancel = () => { cleanup(); reject(new Error('Wallet connection cancelled.')); };
    onEscape = event => { if (event.key === 'Escape') cancel(); };
    modal.cancelCallback = cancel;
    modal.callback = (id?: string) => {
      cleanup();
      if (!id || !approvedWalletProviderIds.includes(id)) { reject(new Error('Choose Leather or Xverse.')); return; }
      resolve(id);
    };
    document.addEventListener('keydown', onEscape);
    timer = setTimeout(() => { cleanup(); reject(new Error('Wallet selection timed out. Try connecting again.')); }, 120_000);
    document.body.appendChild(modal);
  });
  const provider = getProviderFromId(providerId) as WalletProvider | undefined;
  if (!provider?.request) throw new Error('Wallet extension was not found. Install or enable it, then reload the page.');
  console.info('[wallet:connect] requesting account', { providerId, network });
  try {
    const response = await requestStacksWalletAccounts(providerId, provider, 60_000, network);
    prefetchSbtcBalance(requireStacksAccount(response, network).address);
    setSelectedProviderId(providerId);
    console.info('[wallet:connect] connected', { providerId });
    return response;
  } catch (error) {
    console.warn('[wallet:connect] failed', { providerId, message: error instanceof Error ? error.message : 'Unknown wallet error' });
    throw error;
  }
}

export function requestTestnetWalletAccounts(providerId: string, provider: WalletProvider, timeoutMs = 60_000) {
  return requestStacksWalletAccounts(providerId, provider, timeoutMs, 'testnet');
}

export function connectTestnetWallet() {
  return connectStacksWallet('testnet');
}
