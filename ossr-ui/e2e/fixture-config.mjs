import { getAddressFromPrivateKey, privateKeyToPublic } from '@stacks/transactions';
// Public, deterministic TEST FIXTURE keys. Never fund or use these accounts.
export const originKey = `${'1'.padStart(64, '0')}01`;
export const sponsorKey = `${'2'.padStart(64, '0')}01`;
export const origin = getAddressFromPrivateKey(originKey, 'testnet');
export const sponsor = getAddressFromPrivateKey(sponsorKey, 'testnet');
export const originPublicKey = privateKeyToPublic(originKey);
export const sbtcContract = 'SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token';
export const adapter = `${sponsor}.sbtc-sponsored-transfer-v1`;
export const fixtureEnv = {
  OSSR_DEPLOYMENT: 'fixture',
  OSSR_RELAY_PROXY_URL: 'http://127.0.0.1:1',
  STACKS_API_URL: 'http://127.0.0.1:1',
  NEXT_PUBLIC_OSSR_FIXTURE: 'true',
  OSSR_UI_DIST_DIR: '.next-readiness',
  NEXT_PUBLIC_OSSR_NETWORK: 'testnet',
  NEXT_PUBLIC_OSSR_RELAY_URL: '/relay',
  NEXT_PUBLIC_OSSR_QUOTE_PUBLIC_KEY: privateKeyToPublic(sponsorKey),
  NEXT_PUBLIC_OSSR_RELAY_ID: 'fixture-relay',
  NEXT_PUBLIC_OSSR_QUOTE_KEY_ID: 'fixture-key',
  NEXT_PUBLIC_OSSR_POLICY_VERSION: 'fixture',
  NEXT_PUBLIC_OSSR_ADAPTER_CONTRACT: adapter,
  NEXT_PUBLIC_OSSR_SBTC_CONTRACT: sbtcContract,
  NEXT_PUBLIC_OSSR_SPONSOR_PRINCIPAL: sponsor,
};
