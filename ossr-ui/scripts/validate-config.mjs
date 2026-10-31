import { isIP } from 'node:net';
import { validateStacksAddress, compressPublicKey, createAddress, addressToString } from '@stacks/transactions';
const canonicalAddress = (value, network) => typeof value === 'string'
  && (network === 'mainnet' ? /^(SP|SM)/ : /^(ST|SN)/).test(value)
  && validateStacksAddress(value)
  && addressToString(createAddress(value)) === value;
const canonicalStandardAddress = (value, network) => canonicalAddress(value, network)
  && (network === 'mainnet' ? /^SP/.test(value) : /^ST/.test(value));

export function validateDeploymentConfig(env) {
  const errors = [];
  if (env.NEXT_PUBLIC_OSSR_FIXTURE === 'true') errors.push('Public deployments must not enable fixture mode');
  for (const key of ['OSSR_RELAY_PROXY_URL', 'STACKS_API_URL']) {
    try {
      const url = new URL(env[key]);
      if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'localhost' || !url.hostname.includes('.') || isIP(url.hostname)) throw new Error();
    } catch { errors.push(`${key} must be a public HTTPS URL without credentials`); }
  }
  const network = env.NEXT_PUBLIC_OSSR_NETWORK;
  if (network !== 'testnet' && network !== 'mainnet') errors.push('NEXT_PUBLIC_OSSR_NETWORK must be testnet or mainnet');
  if (!/^(02|03)[0-9a-f]{64}$/i.test(env.NEXT_PUBLIC_OSSR_QUOTE_PUBLIC_KEY ?? '')) errors.push('NEXT_PUBLIC_OSSR_QUOTE_PUBLIC_KEY must be a compressed secp256k1 public key');
  try { compressPublicKey(env.NEXT_PUBLIC_OSSR_QUOTE_PUBLIC_KEY ?? ''); } catch { errors.push('Quote public key is not a valid curve point'); }
  for (const key of ['NEXT_PUBLIC_OSSR_RELAY_ID', 'NEXT_PUBLIC_OSSR_QUOTE_KEY_ID', 'NEXT_PUBLIC_OSSR_POLICY_VERSION']) {
    if (!env[key]?.trim()) errors.push(`${key} is required`);
  }
  for (const key of ['NEXT_PUBLIC_OSSR_ADAPTER_CONTRACT', 'NEXT_PUBLIC_OSSR_SBTC_CONTRACT']) {
    if (!canonicalAddress(env[key]?.split('.')[0], network) || !/^[A-Z0-9]+\.[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(env[key] ?? '')) errors.push(`${key} must be a ${network} contract principal`);
  }
  if (!canonicalStandardAddress(env.NEXT_PUBLIC_OSSR_SPONSOR_PRINCIPAL, network)) errors.push(`NEXT_PUBLIC_OSSR_SPONSOR_PRINCIPAL must be a standard ${network} address`);
  if (network === 'mainnet') {
    if (env.NEXT_PUBLIC_OSSR_ADAPTER_CONTRACT !== 'SP17M2KWEK37A5MPDTMWGXJFGJCY41JVQKVK828TQ.sbtc-sponsored-transfer-mainnet-v1') errors.push('Mainnet adapter must match the deployed OSSR sBTC adapter');
    if (env.NEXT_PUBLIC_OSSR_SBTC_CONTRACT !== 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token') errors.push('Mainnet sBTC contract must match the canonical token');
    if (!env.STACKS_API_URL?.includes('mainnet')) errors.push('STACKS_API_URL must point to Stacks mainnet');
  }
  if (network === 'testnet' && env.STACKS_API_URL?.includes('mainnet')) errors.push('STACKS_API_URL must point to Stacks testnet');
  return errors;
}
