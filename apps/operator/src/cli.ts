import { betaBudgetFromEnv } from './beta-budget.js';
import { betaAccessFromEnv } from './beta-access.js';
import { x402ConfigFromEnv } from './x402.js';
import { config as loadEnv } from 'dotenv';
import { OssrOperator } from './operator.js';
import { createRelayServer } from './api.js';
import { JsonReimbursementStore, SbtcReimbursementService } from './reimbursement.js';
import { JsonOperatorRegistryStore, OperatorRegistry } from './registry.js';
import { JsonQuoteStore } from './quote-store.js';
import { JsonNonceStore } from './nonce-store.js';
import { getAddressFromPrivateKey } from '@stacks/transactions';
import { stacksApiUrlForNetwork, stacksNetworkFromEnv } from './network.js';

loadEnv({ path: '.env.local', quiet: true });
// Optional public USDCx settings for installations with a protected .env.local.
loadEnv({ path: '.env.usdcx.local', quiet: true });
// Public payment configuration for installations with a protected .env.local.
loadEnv({ path: '.env.x402.local', quiet: true });
loadEnv({ quiet: true });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}; copy .env.example to .env and set it.`);
  return value;
}

const command = process.argv[2] ?? 'health';
const network = stacksNetworkFromEnv();
const isMainnet = network === 'mainnet';
const stacksApiUrl = stacksApiUrlForNetwork(network);
const sponsorPrivateKey = required(isMainnet ? 'MAINNET_SPONSOR_PRIVATE_KEY' : 'SPONSOR_PRIVATE_KEY');
const sponsorAddress = getAddressFromPrivateKey(sponsorPrivateKey, network);
if (isMainnet && process.env.MAINNET_SPONSOR_ADDRESS && process.env.MAINNET_SPONSOR_ADDRESS.trim() !== sponsorAddress) throw new Error('MAINNET_SPONSOR_ADDRESS does not match MAINNET_SPONSOR_PRIVATE_KEY.');
const operator = new OssrOperator({
  network,
  sponsorPrivateKey,
  stacksApiUrl,
  minimumBalanceMicroStx: BigInt(isMainnet ? process.env.MAINNET_OPERATOR_MINIMUM_BALANCE_MICROSTX ?? '1000000' : process.env.OPERATOR_MINIMUM_BALANCE_MICROSTX ?? '0'),
  nonceStore: new JsonNonceStore(isMainnet ? process.env.MAINNET_NONCE_STORE_PATH ?? '.ossr/mainnet-nonces.json' : process.env.NONCE_STORE_PATH ?? '.ossr/nonces.json'),
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
  if (command === 'nonce-status') {
    console.log(JSON.stringify(await operator.nonceReservations(), null, 2));
    return;
  }
  if (command === 'nonce-reconcile') {
    console.log(JSON.stringify(await operator.reconcileNonceReservations(), null, 2));
    return;
  }
  if (command === 'serve') {
    const port = Number(process.env.OPERATOR_PORT ?? '3002');
    const host = process.env.OPERATOR_HOST?.trim() || '127.0.0.1';
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('OPERATOR_PORT must be a valid TCP port.');
    const quotePrivateKey = required(isMainnet ? 'MAINNET_QUOTE_PRIVATE_KEY' : 'QUOTE_PRIVATE_KEY');
    if (isMainnet && quotePrivateKey === sponsorPrivateKey) throw new Error('Mainnet quote and sponsor keys must be different.');
    const simulationApiUrl = isMainnet ? required('MAINNET_STACKS_SIMULATION_API_URL') : process.env.STACKS_SIMULATION_API_URL?.trim();
    if (isMainnet && process.env.MAINNET_SBTC_DYNAMIC_PRICING !== 'true') throw new Error('Set MAINNET_SBTC_DYNAMIC_PRICING=true before serving mainnet sponsorships.');
    // Testnet PoC default: the configured user wallet is the reimbursement payer.
    // Fallback to the operator sponsor key so the reimbursement worker is active by default.
    const atomicSbtcEnabled = isMainnet || Boolean(process.env.ADAPTER_CONTRACT_ADDRESS?.trim());
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
    const registryPath = isMainnet ? process.env.MAINNET_OPERATOR_REGISTRY_PATH : process.env.OPERATOR_REGISTRY_PATH;
    const registry = registryPath ? new OperatorRegistry(new JsonOperatorRegistryStore(registryPath), undefined, {
      minimumBalanceMicroStx: BigInt(process.env.OPERATOR_MINIMUM_BALANCE_MICROSTX ?? '1'),
      heartbeatTimeoutMs: Number(process.env.OPERATOR_HEARTBEAT_TIMEOUT_MS ?? '60000'),
      maximumFailureRate: Number(process.env.OPERATOR_MAXIMUM_FAILURE_RATE ?? '0.5'),
    }) : undefined;
    const server = createRelayServer({
      operator,
      stacksApiUrl,
      x402: x402ConfigFromEnv(process.env),
      maximumFeeMicroStx: BigInt(isMainnet ? process.env.MAINNET_OPERATOR_MAXIMUM_FEE_MICROSTX ?? '100000' : process.env.OPERATOR_MAXIMUM_FEE_MICROSTX ?? '100000'),
      reimbursementService,
      reimbursementPollIntervalMs: Number(process.env.REIMBURSEMENT_POLL_INTERVAL_MS ?? '10000'),
      registry,
      healthRegistry: registry,
      operatorId: (isMainnet ? process.env.MAINNET_OPERATOR_ID : process.env.OPERATOR_ID)?.trim(),
      healthPollIntervalMs: Number(process.env.OPERATOR_HEALTH_POLL_INTERVAL_MS ?? '10000'),
      quotePrivateKey,
      quoteKeyId: (isMainnet ? required('MAINNET_QUOTE_KEY_ID') : process.env.QUOTE_KEY_ID)?.trim(),
      relayId: (isMainnet ? required('MAINNET_RELAY_ID') : process.env.RELAY_ID)?.trim(),
      policyVersion: (isMainnet ? required('MAINNET_OSSR_POLICY_VERSION') : process.env.OSSR_POLICY_VERSION)?.trim(),
      adapterContractAddress: (isMainnet ? process.env.MAINNET_ADAPTER_CONTRACT_ADDRESS ?? 'SP17M2KWEK37A5MPDTMWGXJFGJCY41JVQKVK828TQ' : process.env.ADAPTER_CONTRACT_ADDRESS)?.trim(),
      adapterContractName: (isMainnet ? process.env.MAINNET_ADAPTER_CONTRACT_NAME ?? 'sbtc-sponsored-transfer-mainnet-v1' : process.env.ADAPTER_CONTRACT_NAME)?.trim(),
      sbtcContractAddress: (isMainnet ? process.env.MAINNET_SBTC_CONTRACT_ADDRESS ?? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4' : process.env.SBTC_CONTRACT_ADDRESS)?.trim(),
      sbtcContractName: (isMainnet ? process.env.MAINNET_SBTC_CONTRACT_NAME ?? 'sbtc-token' : process.env.SBTC_CONTRACT_NAME)?.trim(),
      usdcxAdapterContractAddress: isMainnet ? undefined : process.env.USDCX_ADAPTER_CONTRACT_ADDRESS?.trim(),
      usdcxContractAddress: isMainnet ? undefined : process.env.USDCX_CONTRACT_ADDRESS?.trim(),
      usdcxContractName: isMainnet ? undefined : process.env.USDCX_CONTRACT_NAME?.trim(),
      usdcxSponsorFeeUnits: isMainnet ? undefined : process.env.USDCX_SPONSOR_FEE_UNITS ? BigInt(process.env.USDCX_SPONSOR_FEE_UNITS) : undefined,
      quoteLifetimeBlocks: BigInt(process.env.QUOTE_TTL_BLOCKS ?? '10'),
      breakEvenFeeSats: BigInt(process.env.SBTC_BREAK_EVEN_FEE_SATS ?? '1'),
      // Mainnet sponsorship requires a live STX/BTC cost floor; testnet retains its opt-in policy.
      dynamicPricing: isMainnet || process.env.SBTC_DYNAMIC_PRICING === 'true',
      estimatedTransactionBytes: BigInt(isMainnet ? process.env.MAINNET_SBTC_ESTIMATED_TRANSACTION_BYTES ?? '600' : process.env.SBTC_ESTIMATED_TRANSACTION_BYTES ?? '600'),
      infrastructureCostSats: BigInt(isMainnet ? process.env.MAINNET_SBTC_INFRASTRUCTURE_COST_SATS ?? '0' : process.env.SBTC_INFRASTRUCTURE_COST_SATS ?? '0'),
      riskReserveSats: BigInt(isMainnet ? process.env.MAINNET_SBTC_RISK_RESERVE_SATS ?? '0' : process.env.SBTC_RISK_RESERVE_SATS ?? '0'),
      minimumProfitSats: BigInt(isMainnet ? process.env.MAINNET_SBTC_MINIMUM_PROFIT_SATS ?? '1' : process.env.SBTC_MINIMUM_PROFIT_SATS ?? '1'),
      pricingApiUrl: (isMainnet ? process.env.MAINNET_SBTC_PRICING_API_URL : process.env.SBTC_PRICING_API_URL)?.trim(),
      pricingCacheMs: Number((isMainnet ? process.env.MAINNET_SBTC_PRICING_CACHE_SECONDS : process.env.SBTC_PRICING_CACHE_SECONDS) ?? '60') * 1_000,
      pricingScaleSats: BigInt(isMainnet ? process.env.MAINNET_SBTC_LOG_SCALE_SATS ?? '100' : process.env.SBTC_LOG_SCALE_SATS ?? '100'),
      pricingGrowthSats: BigInt(isMainnet ? process.env.MAINNET_SBTC_LOG_GROWTH_SATS ?? '2' : process.env.SBTC_LOG_GROWTH_SATS ?? '2'),
      sponsorFeeSats: (isMainnet ? process.env.MAINNET_SBTC_SPONSOR_FEE_SATS : process.env.SBTC_SPONSOR_FEE_SATS)
        ? BigInt((isMainnet ? process.env.MAINNET_SBTC_SPONSOR_FEE_SATS : process.env.SBTC_SPONSOR_FEE_SATS)!)
        : undefined,
      betaAccess: betaAccessFromEnv(process.env, network),
      betaBudget: betaBudgetFromEnv(process.env),
      betaAccountingToken: process.env.OSSR_BETA_ACCOUNTING_TOKEN,
      operatorHeartbeatToken: process.env.OPERATOR_HEARTBEAT_TOKEN?.trim(),
      pauseFilePath: isMainnet ? process.env.MAINNET_OSSR_PAUSE_FILE || '.ossr/mainnet-paused' : process.env.OSSR_PAUSE_FILE || '.ossr/paused',
      corsAllowedOrigins: process.env.OSSR_CORS_ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean),
      simulationApiUrl,
      simulationAuthToken: (isMainnet ? process.env.MAINNET_STACKS_SIMULATION_AUTH_TOKEN : process.env.STACKS_SIMULATION_AUTH_TOKEN)?.trim(),
      simulationTimeoutMs: Number(process.env.STACKS_SIMULATION_TIMEOUT_MS ?? '15000'),
      quoteStore: new JsonQuoteStore(isMainnet ? process.env.MAINNET_QUOTE_STORE_PATH ?? '.ossr/mainnet-quotes.json' : process.env.QUOTE_STORE_PATH ?? '.ossr/quotes.json'),
    });
    server.listen(port, host, () => console.log(JSON.stringify({ event: 'relay.listening', host, port, operator: operator.address })));
    return;
  }
  throw new Error('Usage: npm run operator:health | npm run operator:status -- <txid> | npm run operator:nonce-status | npm run operator:nonce-reconcile | npm run operator:serve');
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
