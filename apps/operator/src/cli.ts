import { config as loadEnv } from 'dotenv';
import { OssrOperator } from './operator.js';
import { createRelayServer } from './api.js';
import { JsonReimbursementStore, SbtcReimbursementService } from './reimbursement.js';

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
    const port = Number(process.env.OPERATOR_PORT ?? '3000');
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('OPERATOR_PORT must be a valid TCP port.');
    const payerPrivateKey = process.env.REIMBURSEMENT_PAYER_PRIVATE_KEY?.trim();
    const reimbursementService = payerPrivateKey ? new SbtcReimbursementService({
      operator,
      payerPrivateKey,
      store: new JsonReimbursementStore(process.env.REIMBURSEMENT_STORE_PATH ?? '.ossr/reimbursements.json'),
      stacksApiUrl: process.env.STACKS_API_URL,
      sbtcContractAddress: process.env.SBTC_CONTRACT_ADDRESS,
      sbtcContractName: process.env.SBTC_CONTRACT_NAME,
      paymentFeeMicroStx: BigInt(process.env.REIMBURSEMENT_PAYMENT_FEE_MICROSTX ?? '10000'),
      policy: {
        rateNumerator: BigInt(process.env.REIMBURSEMENT_RATE_NUMERATOR ?? '1'),
        rateDenominator: BigInt(process.env.REIMBURSEMENT_RATE_DENOMINATOR ?? '100'),
        markupBps: BigInt(process.env.REIMBURSEMENT_MARKUP_BPS ?? '500'),
        failureReserveSats: BigInt(process.env.REIMBURSEMENT_FAILURE_RESERVE_SATS ?? '2'),
        minimumReimbursementSats: BigInt(process.env.REIMBURSEMENT_MINIMUM_SATS ?? '10'),
        maximumReimbursementSats: BigInt(process.env.REIMBURSEMENT_MAXIMUM_SATS ?? '1000'),
      },
    }) : undefined;
    const server = createRelayServer({
      operator,
      stacksApiUrl: process.env.STACKS_API_URL,
      maximumFeeMicroStx: BigInt(process.env.OPERATOR_MAXIMUM_FEE_MICROSTX ?? '100000'),
      reimbursementService,
      reimbursementPollIntervalMs: Number(process.env.REIMBURSEMENT_POLL_INTERVAL_MS ?? '10000'),
    });
    server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ event: 'relay.listening', port, operator: operator.address })));
    return;
  }
  throw new Error('Usage: npm run operator:health | npm run operator:status -- <txid> | npm run operator:serve');
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
