import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDeploymentConfig } from './validate-config.mjs';
const env = { OSSR_RELAY_PROXY_URL: 'https://relay.example.com', STACKS_API_URL: 'https://api.testnet.hiro.so', NEXT_PUBLIC_OSSR_NETWORK: 'testnet', NEXT_PUBLIC_OSSR_QUOTE_PUBLIC_KEY: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', NEXT_PUBLIC_OSSR_RELAY_ID: 'relay', NEXT_PUBLIC_OSSR_QUOTE_KEY_ID: 'key', NEXT_PUBLIC_OSSR_POLICY_VERSION: '1', NEXT_PUBLIC_OSSR_ADAPTER_CONTRACT: 'ST14MZ2VA0731Q6TEPK82FDQNHWKY8NPEMND33NE4.adapter', NEXT_PUBLIC_OSSR_SBTC_CONTRACT: 'SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token', NEXT_PUBLIC_OSSR_SPONSOR_PRINCIPAL: 'ST14MZ2VA0731Q6TEPK82FDQNHWKY8NPEMND33NE4' };
test('public builds require explicit trust and public HTTPS dependencies', () => {
  assert.deepEqual(validateDeploymentConfig(env), []);
  assert.ok(validateDeploymentConfig({ ...env, NEXT_PUBLIC_OSSR_FIXTURE: 'true' }).length);
  for (const key of Object.keys(env)) assert.ok(validateDeploymentConfig({ ...env, [key]: undefined }).length, key);
  for (const url of ['http://relay.example.com', 'https://localhost', 'https://127.0.0.1', 'https://user:password@relay.example.com']) assert.ok(validateDeploymentConfig({ ...env, OSSR_RELAY_PROXY_URL: url }).length);
  assert.ok(validateDeploymentConfig({ ...env, NEXT_PUBLIC_OSSR_NETWORK: 'mainnet' }).length);
});
