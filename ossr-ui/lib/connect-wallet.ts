import { DEFAULT_PROVIDERS, request, setSelectedProviderId, type StacksProvider } from '@stacks/connect';
import { getInstalledProviders, getProviderFromId } from '@stacks/connect-ui';
import { defineCustomElements } from '@stacks/connect-ui/loader';
import { approvedWalletProviderIds, requireTestnetStacksAccount } from './stacks-wallet';
import { enableDarkStacksWalletSelector } from './stacks-wallet-theme';

type WalletProvider = { request(method: string, params: Record<string, unknown>): Promise<unknown> };

export function walletConnectionRequest(providerId: string) {
  return providerId === 'XverseProviders.BitcoinProvider'
    ? { method: 'wallet_connect', params: { network: 'Testnet', addresses: ['stacks'], message: 'Connect to OSSR on Stacks testnet' } }
    : { method: 'stx_getAddresses', params: { network: 'testnet' } };
}

export async function withWalletTimeout<T>(operation: Promise<T>, timeoutMs = 60_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('The wallet did not respond. Open or unlock Xverse or Leather, dismiss any pending request, then try connecting again.')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export async function requestTestnetWalletAccounts(providerId: string, provider: WalletProvider, timeoutMs = 60_000) {
  const connection = walletConnectionRequest(providerId);
  // Route by the selected provider ID, not Connect's legacy feature detection.
  // Bound the raw request so a late wallet response cannot update Connect's cache.
  const adapter = {
    request: async () => {
      const result = await withWalletTimeout(provider.request(connection.method, connection.params), timeoutMs);
      if (result && typeof result === 'object' && !('error' in result)) requireTestnetStacksAccount(result);
      return result;
    },
  } as unknown as StacksProvider;
  const response = await request({ provider: adapter, enableOverrides: false }, 'getAddresses');
  requireTestnetStacksAccount(response);
  return response;
}

export async function connectTestnetWallet() {
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
  console.info('[wallet:connect] requesting testnet account', { providerId });
  try {
    const response = await requestTestnetWalletAccounts(providerId, provider);
    setSelectedProviderId(providerId);
    console.info('[wallet:connect] connected', { providerId });
    return response;
  } catch (error) {
    console.warn('[wallet:connect] failed', { providerId, message: error instanceof Error ? error.message : 'Unknown wallet error' });
    throw error;
  }
}
