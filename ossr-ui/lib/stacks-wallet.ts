export type WalletAddress = {
  symbol?: string;
  address?: string;
  publicKey?: string;
};

export const approvedWalletProviderIds = [
  'LeatherProvider',
  'XverseProviders.BitcoinProvider',
];

export const connectedWalletPublicKeyKey = 'ossr-ui:connected-stx-public-key';

export function readWalletAddresses(response: unknown): WalletAddress[] {
  if (!isRecord(response)) return [];
  const result = isRecord(response.result) ? response.result : response;
  return Array.isArray(result.addresses) ? result.addresses as WalletAddress[] : [];
}

export function readStacksAddress(response: unknown): string | undefined {
  return readStacksAccount(response)?.address;
}

export function requireTestnetStacksAccount(response: unknown): WalletAddress & { address: string } {
  const account = readStacksAccount(response);
  if (account?.address) return { ...account, address: account.address };
  if (readWalletAddresses(response).some(entry => typeof entry.address === 'string' && /^(SP|SM)/.test(entry.address))) {
    throw new Error('OSSR currently uses Stacks testnet. Switch Leather or Xverse to testnet, then reconnect.');
  }
  throw new Error('The wallet did not return a Stacks testnet address. Enable Stacks in your wallet and reconnect.');
}

// Connect stores STX addresses separately and omits public keys from its cache.
export function readCachedStacksAccount(session: unknown, expectedAddress?: string): WalletAddress | undefined {
  if (!isRecord(session) || !isRecord(session.addresses)) return undefined;
  const response = { addresses: session.addresses.stx };
  return readStacksAccount(response, expectedAddress) ?? readStacksAccount(response);
}

export function readStacksAccount(response: unknown, expectedAddress?: string): WalletAddress | undefined {
  return readWalletAddresses(response).find(entry => (
    typeof entry.address === 'string'
    && /^(ST|SN)/.test(entry.address)
    && (entry.symbol?.toUpperCase() === 'STX' || entry.address.startsWith('S'))
    && (!expectedAddress || entry.address === expectedAddress)
  ));
}

export function requiresPrebuiltSponsoredTransaction(providerId: string | null | undefined): boolean {
  const normalized = providerId?.toLowerCase() ?? '';
  return normalized.includes('xverse') || normalized.includes('fordefi');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
