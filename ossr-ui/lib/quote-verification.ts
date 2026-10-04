import { bufferCV, createAddress, addressToString, contractPrincipalCV, encodeStructuredDataBytes, hashStructuredData, noneCV, principalCV, publicKeyFromSignatureRsv, someCV, stringAsciiCV, tupleCV, uintCV, validateStacksAddress, verifySignature } from '@stacks/transactions';
import { sha256 } from '@noble/hashes/sha256';
import type { Quote, QuoteResponse } from './ossr';
import { isValidRelayUrl } from './relay-url';
import { compressPublicKey } from '@stacks/transactions';

export type TransferIntent = { relayUrl: string; origin: string; recipient: string; amountSats: string; maxSponsorFeeSats: string; memo?: string };
export type QuoteTrust = { publicKey: string; relayId: string; keyId: string; policyVersion: string; adapterContract: string; sbtcContract: string; sponsorPrincipal: string };
export function configuredQuoteTrust(): QuoteTrust {
  const trust = {
    publicKey: process.env.NEXT_PUBLIC_OSSR_QUOTE_PUBLIC_KEY ?? '',
    relayId: process.env.NEXT_PUBLIC_OSSR_RELAY_ID ?? '',
    keyId: process.env.NEXT_PUBLIC_OSSR_QUOTE_KEY_ID ?? '',
    policyVersion: process.env.NEXT_PUBLIC_OSSR_POLICY_VERSION ?? '',
    adapterContract: process.env.NEXT_PUBLIC_OSSR_ADAPTER_CONTRACT ?? '',
    sbtcContract: process.env.NEXT_PUBLIC_OSSR_SBTC_CONTRACT ?? '',
    sponsorPrincipal: process.env.NEXT_PUBLIC_OSSR_SPONSOR_PRINCIPAL ?? '',
  };
  if (Object.values(trust).some(value => !value)) throw new Error('Quote trust is not configured. Configure the trusted relay identity and public key before signing.');
  return trust;
}
export function validateIntent(input: TransferIntent): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of ['origin', 'recipient'] as const) {
    if (!validateStacksAddress(input[field]) || !/^(ST|SN)/.test(input[field]) || addressToString(createAddress(input[field])) !== input[field]) errors[field] = 'Use a canonical Stacks testnet address.';
  }
  if (input.origin === input.recipient) errors.recipient = 'Choose a recipient other than your wallet.';
  for (const field of ['amountSats', 'maxSponsorFeeSats'] as const) {
    if (!/^[1-9][0-9]*$/.test(input[field]) || BigInt(input[field]) >= 2n ** 128n) errors[field] = 'Enter positive whole sats within the Clarity uint range.';
  }
  if (input.memo !== undefined && !/^0x(?:[0-9a-f]{2}){0,34}$/i.test(input.memo)) errors.memo = 'Memo must contain at most 34 bytes encoded as hex.';
  if (!isValidRelayUrl(input.relayUrl, typeof location !== 'undefined' ? location.href : undefined)) {
    errors.relayUrl = 'Use a same-site relay path or an absolute HTTP(S) relay URL; HTTPS pages require HTTPS.';
  }
  return errors;
}
export function assertFreshQuote(quote: Quote, height: number) {
  if (!Number.isSafeInteger(height) || height < 0 || BigInt(quote.issuedAtBlock) > BigInt(height) || BigInt(quote.expiresAtBlock) <= BigInt(height)) throw new Error('Quote expired or chain height is stale. Request a fresh quote.');
}
export function verifyQuote(response: QuoteResponse, intent: TransferIntent, trust: QuoteTrust, height: number, balance: string): void {
  if (Object.keys(validateIntent(intent)).length) throw new Error('Correct the transfer fields before requesting approval.');
  const q = response.quote;
  const publicKey = normalizeQuotePublicKey(trust.publicKey);
  const expected = { protocolVersion: '1', network: 'testnet', action: 'sbtc-transfer', functionName: 'sponsored-transfer', origin: intent.origin, relayId: trust.relayId, keyId: trust.keyId, policyVersion: trust.policyVersion, adapterContract: trust.adapterContract, sponsorPrincipal: trust.sponsorPrincipal };
  for (const [key, value] of Object.entries(expected)) if (q[key as keyof Quote] !== value) throw new Error(`Untrusted quote ${key}.`);
  if (normalizeQuotePublicKey(response.quotePublicKey) !== publicKey || q.reimbursementAsset.contract !== trust.sbtcContract || q.reimbursementAsset.assetId !== 'sbtc' || q.reimbursementAsset.unit !== 'sat' || q.reimbursementAsset.decimals !== '8') throw new Error('Untrusted quote key or asset.');
  for (const value of [q.sponsorFee, q.maxNetworkFeeMicroStx, q.issuedAtBlock, q.expiresAtBlock]) {
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 39 || BigInt(value) >= 2n ** 128n) throw new Error('Malformed quote integer.');
  }
  if (BigInt(q.sponsorFee) === 0n || BigInt(q.maxNetworkFeeMicroStx) === 0n) throw new Error('Quote fees must be positive.');
  if (!/^0x[0-9a-f]{64}$/i.test(q.quoteId) || !/^0x[0-9a-f]{64}$/i.test(q.argumentsHash) || !/^[0-9a-f]{130}$/i.test(q.signature)) throw new Error('Malformed quote digest or signature.');
  const argumentsHash = `0x${hashStructuredData(tupleCV({ amount: uintCV(BigInt(intent.amountSats)), recipient: principalCV(intent.recipient), 'sponsor-fee': uintCV(BigInt(q.sponsorFee)), 'quote-id': bufferCV(hexToBytes(q.quoteId)), 'expiry-height': uintCV(BigInt(q.expiresAtBlock)), memo: intent.memo === undefined ? noneCV() : someCV(bufferCV(hexToBytes(intent.memo))) }))}`;
  if (q.argumentsHash !== argumentsHash) throw new Error('Quote does not match the reviewed transfer.');
  const digest = sha256(encodeStructuredDataBytes({ message: quoteMessageCV(q), domain: quoteDomainCV() }));
  const digestHex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  if (publicKeyFromSignatureRsv(digestHex, q.signature) !== publicKey || !verifySignature(q.signature.slice(0, 128), digest, publicKey)) throw new Error('Invalid relay quote signature.');
  assertFreshQuote(q, height);
  if (BigInt(q.sponsorFee) > BigInt(intent.maxSponsorFeeSats)) throw new Error('Sponsor fee exceeds your reviewed maximum.');
  if (!/^[0-9]+$/.test(balance) || BigInt(intent.amountSats) + BigInt(q.sponsorFee) > BigInt(balance)) throw new Error('Insufficient testnet sBTC for amount plus sponsor fee.');
}
function normalizeQuotePublicKey(value: string): string {
  if (typeof value !== 'string' || !/^(?:0x)?(?:(?:02|03)[0-9a-f]{64}|04[0-9a-f]{128})$/i.test(value)) throw new Error('Malformed quote public key. Use a secp256k1 public key.');
  try {
    return compressPublicKey(value.replace(/^0x/i, '')).toLowerCase();
  } catch {
    throw new Error('Malformed quote public key. Use a valid secp256k1 public key.');
  }
}
function splitContractPrincipal(value: string): [string, string] { const [address, name] = value.split('.'); if (!address || !name) throw new Error('Invalid contract principal'); return [address, name]; }
function hexToBytes(value: string) { return Uint8Array.from(value.slice(2).match(/../g) ?? [], byte => parseInt(byte, 16)); }

function quoteDomainCV() {
  return tupleCV({ name: stringAsciiCV('ossr-quote'), version: stringAsciiCV('1'), 'chain-id': uintCV(2147483648n) });
}

function quoteMessageCV(quote: Quote) {
  const [assetAddress, assetName] = splitContractPrincipal(quote.reimbursementAsset.contract);
  const [adapterAddress, adapterName] = splitContractPrincipal(quote.adapterContract);
  return tupleCV({
    'protocol-version': stringAsciiCV(quote.protocolVersion),
    'quote-id': bufferCV(hexToBytes(quote.quoteId)),
    'relay-id': stringAsciiCV(quote.relayId),
    network: stringAsciiCV(quote.network),
    sponsor: principalCV(quote.sponsorPrincipal),
    origin: principalCV(quote.origin),
    action: stringAsciiCV(quote.action),
    'reimbursement-asset': tupleCV({
      'asset-id': stringAsciiCV(quote.reimbursementAsset.assetId),
      contract: contractPrincipalCV(assetAddress, assetName),
      unit: stringAsciiCV(quote.reimbursementAsset.unit),
      decimals: uintCV(BigInt(quote.reimbursementAsset.decimals)),
    }),
    'adapter-contract': contractPrincipalCV(adapterAddress, adapterName),
    'function-name': stringAsciiCV(quote.functionName),
    'arguments-hash': bufferCV(hexToBytes(quote.argumentsHash)),
    'sponsor-fee': uintCV(BigInt(quote.sponsorFee)),
    'max-network-fee-microstx': uintCV(BigInt(quote.maxNetworkFeeMicroStx)),
    'issued-at-block': uintCV(BigInt(quote.issuedAtBlock)),
    'expires-at-block': uintCV(BigInt(quote.expiresAtBlock)),
    'policy-version': stringAsciiCV(quote.policyVersion),
    'key-id': stringAsciiCV(quote.keyId),
  });
}
