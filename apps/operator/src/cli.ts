import { config as loadEnv } from 'dotenv';
import { OssrOperator } from './operator.js';
import { createRelayServer } from './api.js';
import { JsonReimbursementStore, SbtcReimbursementService } from './reimbursement.js';
import { JsonOperatorRegistryStore, OperatorRegistry } from './registry.js';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}; copy .env.example to .env and set it.`);
  return value;
}

const command = process.argv[2] ?? 'health';
const operator = new OssrOperator({
  network: 'testnet',
  sponsorPrivateKey: required('SPONSOR_PRIVATE_KEY'),
  stacksApiUrl: process.env.STACKS_API_URL,
  minimumBalanceMicroStx: BigInt(process.env.OPERATOR_MINIMUM_BALANCE_MICROSTX ?? '0'),
});

async function main(): Promise<void> {
  if (command === 'health') {
    console.log(JSON.stringify(await operator.health(), null, 2));
    return;
  }
  if (command === 'status') {
    const txid = process.argv[3];
    if (!txid) throw new Error('Usage: npm run operator:status -- <txid>');
    console.log(JSON.stringify(await operator.transactionStatus(txid), null, 2));
    return;
  }
  if (command === 'serve') {
    const port = Number(process.env.OPERATOR_PORT ?? '3002');
    const host = process.env.OPERATOR_HOST?.trim() || '127.0.0.1';
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('OPERATOR_PORT must be a valid TCP port.');
    // Testnet PoC default: the configured user wallet is the reimbursement payer.
    // Fallback to the operator sponsor key so the reimbursement worker is active by default.
    const atomicSbtcEnabled = Boolean(process.env.ADAPTER_CONTRACT_ADDRESS?.trim());
    const payerPrivateKey = process.env.REIMBURSEMENT_PAYER_PRIVATE_KEY?.trim() ?? process.env.USER_PRIVATE_KEY?.trim() ?? process.env.SPONSOR_PRIVATE_KEY?.trim();
    // Atomic adapter calls settle the sponsor fee in their own transaction.
    // Running the legacy worker would pay the sponsor a second time.
    const reimbursementService = !atomicSbtcEnabled && payerPrivateKey ? new SbtcReimbursementService({
      operator,
      payerPrivateKey,
      store: new JsonReimbursementStore(process.env.REIMBURSEMENT_STORE_PATH ?? '.ossr/reimbursements.json'),
      stacksApiUrl: process.env.STACKS_API_URL,
      sbtcContractAddress: process.env.SBTC_CONTRACT_ADDRESS,
      sbtcContractName: process.env.SBTC_CONTRACT_NAME,
      paymentFeeMicroStx: BigInt(process.env.REIMBURSEMENT_PAYMENT_FEE_MICROSTX ?? '10000'),
      operatorPaymentSats: BigInt(process.env.REIMBURSEMENT_OPERATOR_SATS ?? '10'),
      protocolFeeSats: BigInt(process.env.REIMBURSEMENT_PROTOCOL_SATS ?? '2'),
      protocolAddress: process.env.PROTOCOL_ADDRESS?.trim(),
      confirmationTimeoutMs: Number(process.env.CONFIRMATION_TIMEOUT_SECONDS ?? '86400') * 1_000,
      policy: {
        rateNumerator: BigInt(process.env.REIMBURSEMENT_RATE_NUMERATOR ?? '1'),
        rateDenominator: BigInt(process.env.REIMBURSEMENT_RATE_DENOMINATOR ?? '100'),
        markupBps: BigInt(process.env.REIMBURSEMENT_MARKUP_BPS ?? '500'),
        failureReserveSats: BigInt(process.env.REIMBURSEMENT_FAILURE_RESERVE_SATS ?? '2'),
        minimumReimbursementSats: BigInt(process.env.REIMBURSEMENT_MINIMUM_SATS ?? '10'),
        maximumReimbursementSats: BigInt(process.env.REIMBURSEMENT_MAXIMUM_SATS ?? '1000'),
      },
    }) : undefined;
    const registry = process.env.OPERATOR_REGISTRY_PATH ? new OperatorRegistry(new JsonOperatorRegistryStore(process.env.OPERATOR_REGISTRY_PATH), undefined, {
      minimumBalanceMicroStx: BigInt(process.env.OPERATOR_MINIMUM_BALANCE_MICROSTX ?? '1'),
      heartbeatTimeoutMs: Number(process.env.OPERATOR_HEARTBEAT_TIMEOUT_MS ?? '60000'),
      maximumFailureRate: Number(process.env.OPERATOR_MAXIMUM_FAILURE_RATE ?? '0.5'),
    }) : undefined;
    const server = createRelayServer({
      operator,
      stacksApiUrl: process.env.STACKS_API_URL,
      maximumFeeMicroStx: BigInt(process.env.OPERATOR_MAXIMUM_FEE_MICROSTX ?? '100000'),
      reimbursementService,
      reimbursementPollIntervalMs: Number(process.env.REIMBURSEMENT_POLL_INTERVAL_MS ?? '10000'),
      registry,
      healthRegistry: registry,
      operatorId: process.env.OPERATOR_ID?.trim(),
      healthPollIntervalMs: Number(process.env.OPERATOR_HEALTH_POLL_INTERVAL_MS ?? '10000'),
      quotePrivateKey: process.env.QUOTE_PRIVATE_KEY?.trim(),
      quoteKeyId: process.env.QUOTE_KEY_ID?.trim(),
      relayId: process.env.RELAY_ID?.trim(),
      policyVersion: process.env.OSSR_POLICY_VERSION?.trim(),
      adapterContractAddress: process.env.ADAPTER_CONTRACT_ADDRESS?.trim(),
      adapterContractName: process.env.ADAPTER_CONTRACT_NAME?.trim(),
      sbtcContractAddress: process.env.SBTC_CONTRACT_ADDRESS?.trim(),
      sbtcContractName: process.env.SBTC_CONTRACT_NAME?.trim(),
      quoteLifetimeBlocks: BigInt(process.env.QUOTE_TTL_BLOCKS ?? '10'),
      sponsorFeeSats: BigInt(process.env.SBTC_SPONSOR_FEE_SATS ?? process.env.REIMBURSEMENT_OPERATOR_SATS ?? '10'),
      corsAllowedOrigins: process.env.OSSR_CORS_ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean),
    });
    server.listen(port, host, () => console.log(JSON.stringify({ event: 'relay.listening', host, port, operator: operator.address })));
    return;
  }
  throw new Error('Usage: npm run operator:health | npm run operator:status -- <txid> | npm run operator:serve');
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
