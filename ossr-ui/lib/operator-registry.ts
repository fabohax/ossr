import { fetchCallReadOnlyFunction, stringAsciiCV } from '@stacks/transactions';

export const registryLookupFunctionNames = [
  'get-operator',
  'get-operator-by-id',
  'get-registration',
  'get-registration-by-id',
  'get-registered-operator',
  'lookup-operator',
  'get-operator-record',
  'get-operator-metadata',
];

export type OperatorQuoteKey = {
  keyId: string;
  publicKey: string;
  status?: string;
  source?: string;
};

type RegistryLookupOptions = {
  contractAddress: string;
  contractName: string;
  operatorId: string;
  ownerAddress?: string;
  network?: 'testnet' | 'mainnet';
};

export function extractQuoteDistribution(value: unknown): OperatorQuoteKey[] {
  if (!isRecord(value)) return [];

  const rawKeys = Array.isArray(value.quoteKeys)
    ? value.quoteKeys
    : Array.isArray(value.quote_keys)
      ? value.quote_keys
      : Array.isArray(value)
        ? value
        : [];

  const directEntry = !rawKeys.length && (typeof value.publicKey === 'string' || typeof value.quotePublicKey === 'string')
    ? [value]
    : [];

  const entries = [...rawKeys, ...directEntry];
  if (!entries.length) return [];

  return entries
    .map(entry => {
      const record = isRecord(entry) ? entry : {};
      const keyId = typeof record.keyId === 'string'
        ? record.keyId
        : typeof record.id === 'string'
          ? record.id
          : typeof value.keyId === 'string'
            ? value.keyId
            : 'active';
      const publicKey = typeof record.publicKey === 'string'
        ? record.publicKey
        : typeof record.quotePublicKey === 'string'
          ? record.quotePublicKey
          : typeof value.quotePublicKey === 'string'
            ? value.quotePublicKey
            : '';
      const status = typeof record.status === 'string' ? record.status : typeof value.status === 'string' ? value.status : undefined;
      return { keyId, publicKey, status, source: typeof record.source === 'string' ? record.source : undefined };
    })
    .filter(entry => typeof entry.publicKey === 'string' && entry.publicKey.length > 0)
    .map(entry => ({
      keyId: entry.keyId || 'active',
      publicKey: entry.publicKey,
      status: entry.status,
      source: entry.source,
    }));
}

export async function fetchRelayQuoteDistribution(endpoint: string): Promise<OperatorQuoteKey[]> {
  const trimmed = endpoint.trim();
  if (!trimmed) throw new Error('Enter a relay endpoint before checking quote distribution.');

  const url = safeRelayInfoUrl(trimmed);
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`The relay responded with HTTP ${response.status}.`);

  const payload = await response.json();
  return extractQuoteDistribution(payload);
}

export async function fetchOperatorRegistryRecord(options: RegistryLookupOptions): Promise<unknown> {
  const { contractAddress, contractName, operatorId, ownerAddress, network = 'testnet' } = options;
  const normalizedId = operatorId.trim();
  if (!normalizedId) throw new Error('Enter an operator ID before checking the contract.');

  const lookupNames = [...registryLookupFunctionNames];
  let lastError: unknown;

  for (const functionName of lookupNames) {
    try {
      const result = await fetchCallReadOnlyFunction({
        contractAddress,
        contractName,
        functionName,
        functionArgs: [stringAsciiCV(normalizedId)],
        network,
        senderAddress: ownerAddress ?? contractAddress,
      });
      return result;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('The registry contract did not expose a readable operator lookup for this ID.');
}

function safeRelayInfoUrl(endpoint: string): string {
  try {
    const normalized = new URL(endpoint);
    const base = normalized.origin;
    const path = normalized.pathname.endsWith('/v1/info') ? normalized.pathname : `${normalized.pathname.replace(/\/$/, '')}/v1/info`;
    return new URL(path, `${base}/`).toString();
  } catch {
    return new URL('/v1/info', endpoint.endsWith('/') ? endpoint : `${endpoint}/`).toString();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
