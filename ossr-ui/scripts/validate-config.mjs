import { isIP } from 'node:net';
import { validateStacksAddress, compressPublicKey, createAddress, addressToString } from '@stacks/transactions';
const canonicalTestnetAddress = value => typeof value === 'string' && /^(ST|SN)/.test(value) && validateStacksAddress(value) && addressToString(createAddress(value)) === value;

export function validateDeploymentConfig(env) {
  const errors = [];
  if (env.NEXT_PUBLIC_OSSR_FIXTURE === 'true') errors.push('Public deployments must not enable fixture mode');
  for (const key of ['OSSR_RELAY_PROXY_URL', 'STACKS_API_URL']) {
    try {
      const url = new URL(env[key]);
      if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'localhost' || !url.hostname.includes('.') || isIP(url.hostname)) throw new Error();
    } catch { errors.push(`${key} must be a public HTTPS URL without credentials`); }
  }
  if (env.NEXT_PUBLIC_OSSR_NETWORK !== 'testnet') errors.push('NEXT_PUBLIC_OSSR_NETWORK must be testnet');
  if (!/^(02|03)[0-9a-f]{64}$/i.test(env.NEXT_PUBLIC_OSSR_QUOTE_PUBLIC_KEY ?? '')) errors.push('NEXT_PUBLIC_OSSR_QUOTE_PUBLIC_KEY must be a compressed secp256k1 public key');
  try { compressPublicKey(env.NEXT_PUBLIC_OSSR_QUOTE_PUBLIC_KEY ?? ''); } catch { errors.push('Quote public key is not a valid curve point'); }
  for (const key of ['NEXT_PUBLIC_OSSR_RELAY_ID', 'NEXT_PUBLIC_OSSR_QUOTE_KEY_ID', 'NEXT_PUBLIC_OSSR_POLICY_VERSION']) {
    if (!env[key]?.trim()) errors.push(`${key} is required`);
  }
  for (const key of ['NEXT_PUBLIC_OSSR_ADAPTER_CONTRACT', 'NEXT_PUBLIC_OSSR_SBTC_CONTRACT']) {
    if (!canonicalTestnetAddress(env[key]?.split('.')[0]) || !/^(ST|SN)[A-Z0-9]+\.[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(env[key] ?? '')) errors.push(`${key} must be a testnet contract principal`);
  }
  if (!canonicalTestnetAddress(env.NEXT_PUBLIC_OSSR_SPONSOR_PRINCIPAL)) errors.push('NEXT_PUBLIC_OSSR_SPONSOR_PRINCIPAL must be a testnet address');
  return errors;
}
