export type WalletAddress = {
  symbol?: string;
  address?: string;
  publicKey?: string;
};

export const approvedWalletProviderIds = [
  'LeatherProvider',
  'XverseProviders.BitcoinProvider',
  'FordefiProviders.UtxoProvider',
];

export function readWalletAddresses(response: unknown): WalletAddress[] {
  if (!isRecord(response)) return [];
  const result = isRecord(response.result) ? response.result : response;
  return Array.isArray(result.addresses) ? result.addresses as WalletAddress[] : [];
}

export function readStacksAddress(response: unknown): string | undefined {
  return readStacksAccount(response)?.address;
}

export function readStacksAccount(response: unknown, expectedAddress?: string): WalletAddress | undefined {
  return readWalletAddresses(response).find(entry => (
    typeof entry.address === 'string'
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
