import {
  bufferCV,
  noneCV,
  Pc,
  PostConditionMode,
  postConditionToHex,
  serializeCV,
  someCV,
  standardPrincipalCV,
  uintCV,
} from '@stacks/transactions';
import type { ContractIdString } from '@stacks/transactions';

export type RelayInfo = {
  apiVersion: string;
  relayId: string;
  network: 'testnet';
  sponsorPrincipal: string;
  supportedActions: string[];
  adapterContract?: string;
  sbtcContract?: string;
  limits: {
    maxNetworkFeeMicroStx: string;
    quoteLifetimeBlocks: string;
    sponsorFeeSats: string;
  };
  quotesEnabled: boolean;
  sponsorshipsEnabled: boolean;
};

export type Quote = {
  protocolVersion: '1';
  quoteId: string;
  relayId: string;
  network: 'testnet';
  sponsorPrincipal: string;
  origin: string;
  action: 'sbtc-transfer';
  reimbursementAsset: { assetId: 'sbtc'; contract: string; unit: 'sat'; decimals: '8' };
  adapterContract: string;
  functionName: 'sponsored-transfer';
  argumentsHash: string;
  sponsorFee: string;
  maxNetworkFeeMicroStx: string;
  issuedAtBlock: string;
  expiresAtBlock: string;
  policyVersion: string;
  keyId: string;
  signature: string;
};

export type QuoteResponse = {
  quote: Quote;
  quotePublicKey: string;
};

export type SponsorshipResponse = {
  status: 'BROADCAST';
  operator: string;
  transaction_id: string;
  transactionId?: string;
  fee_microstx: string;
  feeMicroStx?: string;
};

export type SponsorshipStatus = {
  transactionId: string;
  quoteId?: string;
  status: string;
  blockHeight?: number;
  raw?: unknown;
};

export type SbtcBalance = {
  address: string;
  balanceSats: string;
  token: string;
};

export type PreparedWalletCall = {
  contract: ContractIdString;
  contractAddress: string;
  contractName: string;
  functionName: string;
  functionArgs: string[];
  postConditions: string[];
  postConditionMode: 'deny';
  sponsored: true;
};

export function normalizeRelayUrl(value: string): string {
  return value.trim().replace(/\/$/, '');
}

export async function fetchRelayInfo(relayUrl: string): Promise<RelayInfo> {
  return fetchJson(`${normalizeRelayUrl(relayUrl)}/v1/info`);
}

export async function requestQuote(input: {
  relayUrl: string;
  origin: string;
  recipient: string;
  amountSats: string;
  maxSponsorFeeSats: string;
  memo?: string;
}): Promise<QuoteResponse> {
  return fetchJson(`${normalizeRelayUrl(input.relayUrl)}/v1/quotes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      origin: input.origin,
      recipient: input.recipient,
      amountSats: input.amountSats,
      maxSponsorFeeSats: input.maxSponsorFeeSats,
      ...(input.memo ? { memo: input.memo } : {}),
    }),
  });
}

export async function submitSponsorship(input: {
  relayUrl: string;
  quoteId: string;
  transaction: string;
  user: string;
}): Promise<SponsorshipResponse> {
  return fetchJson(`${normalizeRelayUrl(input.relayUrl)}/v1/sponsorships`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ quoteId: input.quoteId, transaction: input.transaction, user: input.user }),
  });
}

export async function fetchSponsorshipStatus(relayUrl: string, txid: string): Promise<SponsorshipStatus> {
  const pathTxid = txid.startsWith('0x') ? txid : `0x${txid}`;
  return fetchJson(`${normalizeRelayUrl(relayUrl)}/v1/sponsorships/${pathTxid}`);
}

export async function fetchSbtcBalance(address: string, sbtcContract = 'SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token'): Promise<SbtcBalance> {
  const apiUrl = process.env.NEXT_PUBLIC_STACKS_API_URL ?? 'https://api.testnet.hiro.so';
  const response = await fetchJson<{ fungible_tokens?: Record<string, { balance?: string }> }>(
    `${apiUrl.replace(/\/$/, '')}/extended/v1/address/${address}/balances`,
  );
  const token = `${sbtcContract}::sbtc-token`;
  return {
    address,
    token,
    balanceSats: response.fungible_tokens?.[token]?.balance ?? '0',
  };
}

export function prepareWalletContractCall(input: {
  quote: Quote;
  recipient: string;
  amountSats: string;
  memo?: string;
}): PreparedWalletCall {
  const [contractAddress, contractName] = splitContractPrincipal(input.quote.adapterContract);
  const totalSats = BigInt(input.amountSats) + BigInt(input.quote.sponsorFee);
  const memo = input.memo ? someCV(bufferCV(hexToBytes(input.memo))) : noneCV();
  return {
    contract: asContractId(input.quote.adapterContract),
    contractAddress,
    contractName,
    functionName: input.quote.functionName,
    functionArgs: [
      serializeCV(uintCV(BigInt(input.amountSats))),
      serializeCV(standardPrincipalCV(input.recipient)),
      serializeCV(uintCV(BigInt(input.quote.sponsorFee))),
      serializeCV(bufferCV(hexToBytes(input.quote.quoteId))),
      serializeCV(uintCV(BigInt(input.quote.expiresAtBlock))),
      serializeCV(memo),
    ],
    postConditions: [
      Pc.principal(input.quote.origin)
        .willSendEq(totalSats)
        .ft(asContractId(input.quote.reimbursementAsset.contract), 'sbtc-token'),
    ].map(postCondition => postConditionToHex(postCondition)),
    postConditionMode: 'deny',
    sponsored: true,
  };
}

export function extractRawTransaction(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  const nested = isRecord(result.result) ? result.result : result;
  const raw = nested.transaction ?? nested.txRaw ?? nested.tx_raw;
  if (typeof raw === 'string') return raw.startsWith('0x') ? raw : `0x${raw}`;
  return undefined;
}

export function isFailedChainStatus(status: string | undefined): boolean {
  return Boolean(status && (status.startsWith('abort_') || status === 'dropped_replace_by_fee' || status === 'not_found'));
}

export function isTerminalChainStatus(status: string | undefined): boolean {
  return Boolean(status && (status === 'success' || isFailedChainStatus(status)));
}

export function describeChainStatus(status: SponsorshipStatus | undefined): string {
  if (!status) return 'Waiting for relay status.';
  if (status.status === 'success') return 'Confirmed successfully.';
  if (status.status === 'abort_by_post_condition') {
    return 'The transaction was sponsored and broadcast, but chain execution aborted because a post-condition was not satisfied.';
  }
  if (status.status.startsWith('abort_')) {
    return `The transaction was sponsored and broadcast, but chain execution aborted with ${status.status}.`;
  }
  if (status.status === 'dropped_replace_by_fee') return 'The transaction was dropped after being replaced by fee.';
  if (status.status === 'not_found') return 'The relay has a transaction ID, but the Stacks API does not currently find it.';
  return `Current chain status: ${status.status}.`;
}

export function likelyFailureCause(status: SponsorshipStatus | undefined, context?: {
  amountSats?: string;
  sponsorFeeSats?: string;
  origin?: string;
}): string | undefined {
  if (!status) return undefined;
  const adapterError = adapterErrorFromStatus(status);
  const requiredSats = context?.amountSats && context.sponsorFeeSats && /^\d+$/.test(context.amountSats) && /^\d+$/.test(context.sponsorFeeSats)
    ? (BigInt(context.amountSats) + BigInt(context.sponsorFeeSats)).toString()
    : undefined;
  if (adapterError?.code === 109) {
    return requiredSats
      ? `The adapter failed while reimbursing the sponsor: ERR_FEE_TRANSFER_FAILED (u109). The origin address${context?.origin ? ` ${context.origin}` : ''} needs at least ${requiredSats} sats of testnet sBTC before signing this transfer.`
      : 'The adapter failed while reimbursing the sponsor: ERR_FEE_TRANSFER_FAILED (u109). The origin address does not appear able to pay the sponsor fee in sBTC.';
  }
  if (adapterError?.code === 110) {
    return requiredSats
      ? `The adapter failed while paying the recipient: ERR_RECIPIENT_TRANSFER_FAILED (u110). The origin address needs at least ${requiredSats} sats of testnet sBTC for amount plus sponsor fee.`
      : 'The adapter failed while paying the recipient: ERR_RECIPIENT_TRANSFER_FAILED (u110). Check the origin sBTC balance.';
  }
  if (status.status === 'abort_by_post_condition') {
    const raw = isRecord(status.raw) ? status.raw : {};
    const mode = typeof raw.post_condition_mode === 'string' ? raw.post_condition_mode : undefined;
    return mode === 'deny'
      ? 'The wallet-signed post-condition did not match the actual sBTC asset movement. Check the origin address, sBTC contract principal, token name, amount plus sponsor fee, and recipient.'
      : 'A wallet-signed post-condition did not match the actual asset movement.';
  }
  if (status.status.startsWith('abort_by_response')) return 'The adapter contract returned an error response during execution.';
  if (status.status.startsWith('abort_')) return 'Stacks accepted the transaction, but the contract execution path aborted.';
  return undefined;
}

export function adapterErrorFromStatus(status: SponsorshipStatus | undefined): { code: number; name: string } | undefined {
  const raw = isRecord(status?.raw) ? status.raw : undefined;
  const txResult = isRecord(raw?.tx_result) ? raw.tx_result : undefined;
  const repr = typeof txResult?.repr === 'string' ? txResult.repr : undefined;
  const match = repr?.match(/^\(err u([0-9]+)\)$/);
  if (!match) return undefined;
  const code = Number(match[1]);
  return { code, name: ADAPTER_ERRORS[code] ?? `ERR_${code}` };
}

const ADAPTER_ERRORS: Record<number, string> = {
  100: 'ERR_SPONSOR_REQUIRED',
  101: 'ERR_QUOTE_EXPIRED',
  102: 'ERR_AMOUNT_ZERO',
  103: 'ERR_AMOUNT_TOO_HIGH',
  104: 'ERR_SPONSOR_FEE_ZERO',
  105: 'ERR_SPONSOR_FEE_TOO_HIGH',
  106: 'ERR_RECIPIENT_IS_ORIGIN',
  107: 'ERR_SPONSOR_IS_ORIGIN',
  108: 'ERR_WRONG_NETWORK',
  109: 'ERR_FEE_TRANSFER_FAILED',
  110: 'ERR_RECIPIENT_TRANSFER_FAILED',
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body as T;
}

function splitContractPrincipal(principal: string): [string, string] {
  const index = principal.lastIndexOf('.');
  if (index < 1 || index === principal.length - 1) throw new Error(`Invalid contract principal: ${principal}`);
  return [principal.slice(0, index), principal.slice(index + 1)];
}

function asContractId(principal: string): ContractIdString {
  splitContractPrincipal(principal);
  return principal as ContractIdString;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^0x(?:[0-9a-f]{2})*$/i.test(hex)) throw new Error(`Invalid hex string: ${hex}`);
  return Uint8Array.from(Buffer.from(hex.slice(2), 'hex'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
