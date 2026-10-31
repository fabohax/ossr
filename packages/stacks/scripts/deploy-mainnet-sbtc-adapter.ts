import { config } from 'dotenv';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  broadcastTransaction,
  ClarityVersion,
  estimateTransactionByteLength,
  fetchNonce,
  getAddressFromPrivateKey,
  makeContractDeploy,
} from '@stacks/transactions';

config({ path: '.env.local', quiet: true });
config({ quiet: true });

const network = 'mainnet' as const;
const apiUrl = (process.env.STACKS_MAINNET_API_URL ?? 'https://stacks-node-api.mainnet.stacks.co').replace(/\/$/, '');
if (apiUrl.includes('testnet')) throw new Error('STACKS_MAINNET_API_URL must point to a mainnet API.');
const client = { baseUrl: apiUrl };
const contractName = 'sbtc-sponsored-transfer-mainnet-v1';
const sourcePath = 'contracts/sbtc-sponsored-transfer-mainnet-v1.clar';
const source = readFileSync(sourcePath, 'utf8');

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function waitForConfirmation(txid: string) {
  for (let attempt = 0; attempt < 180; attempt++) {
    const response = await fetch(`${apiUrl}/extended/v1/tx/0x${txid.replace(/^0x/, '')}`);
    if (response.ok) {
      const body = await response.json() as { tx_status: string; block_height?: number };
      if (body.tx_status === 'success') return body;
      if (body.tx_status !== 'pending') throw new Error(`Deployment transaction ${txid}: ${body.tx_status}`);
    } else if (response.status !== 404) {
      throw new Error(`Transaction lookup HTTP ${response.status}`);
    }
    await new Promise(resolve => setTimeout(resolve, 10_000));
  }
  throw new Error(`Confirmation timeout for ${txid}; inspect the transaction before retrying.`);
}

async function main() {
  const key = required('MAINNET_DEPLOYER_PRIVATE_KEY');
  const address = getAddressFromPrivateKey(key, network);
  if (!address.startsWith('SP')) throw new Error('Deployer key did not derive a mainnet address.');
  const expectedAddress = process.env.MAINNET_DEPLOYER_ADDRESS?.trim();
  if (expectedAddress && expectedAddress !== address) throw new Error('MAINNET_DEPLOYER_ADDRESS does not match the configured private key.');
  const contract = `${address}.${contractName}`;

  const existing = await fetch(`${apiUrl}/v2/contracts/source/${address}/${contractName}`, { cache: 'no-store' });
  if (existing.ok) throw new Error(`Contract ${contract} already exists; refusing to deploy again.`);
  if (existing.status !== 404) throw new Error(`Contract lookup HTTP ${existing.status}`);

  const [feeResponse, balanceResponse] = await Promise.all([
    fetch(`${apiUrl}/v2/fees/transfer`, { cache: 'no-store' }),
    fetch(`${apiUrl}/extended/v1/address/${address}/stx`, { cache: 'no-store' }),
  ]);
  if (!feeResponse.ok) throw new Error('Cannot estimate mainnet deployment fee.');
  if (!balanceResponse.ok) throw new Error('Cannot read mainnet deployer balance.');
  const rate = BigInt((await feeResponse.text()).trim());
  const balance = BigInt((await balanceResponse.json() as { balance: string }).balance);
  if (rate <= 0n) throw new Error('Invalid fee rate.');

  const nonce = await fetchNonce({ address, network, client });
  const unsignedFeeTx = await makeContractDeploy({ senderKey: key, contractName, codeBody: source, clarityVersion: ClarityVersion.Clarity4, network, nonce, fee: 0n });
  const fee = rate * BigInt(estimateTransactionByteLength(unsignedFeeTx)) * 2n;
  const feeCap = BigInt(process.env.MAINNET_DEPLOYMENT_FEE_CAP_USTX ?? '50000');
  if (feeCap <= 0n) throw new Error('MAINNET_DEPLOYMENT_FEE_CAP_USTX must be positive.');
  if (fee > feeCap) throw new Error(`Estimated fee ${fee} exceeds the ${feeCap} microSTX deployment cap.`);
  if (balance < fee) throw new Error(`Deployer balance ${balance} microSTX is below estimated fee ${fee} microSTX.`);
  const transaction = await makeContractDeploy({ senderKey: key, contractName, codeBody: source, clarityVersion: ClarityVersion.Clarity4, network, nonce, fee });

  console.log(JSON.stringify({ event: 'mainnet-deployment.prepared', contract, nonce: nonce.toString(), feeMicroStx: fee.toString(), feeCapMicroStx: feeCap.toString(), balanceMicroStx: balance.toString(), sourceSha256: createHash('sha256').update(source).digest('hex') }));
  if (!process.argv.includes('--broadcast')) return;

  const result = await broadcastTransaction({ transaction, network, client });
  if (!('txid' in result)) throw new Error(`Deployment rejected: ${JSON.stringify(result)}`);
  console.log(JSON.stringify({ event: 'mainnet-deployment.broadcast', contract, txid: result.txid }));
  const confirmed = await waitForConfirmation(result.txid);
  const published = await fetch(`${apiUrl}/v2/contracts/source/${address}/${contractName}`);
  if (!published.ok || (await published.json() as { source: string }).source !== source) {
    throw new Error('Published contract source verification failed. Check chain state before retrying.');
  }
  mkdirSync('deployments', { recursive: true });
  const manifest = {
    network,
    contract,
    transactionId: `0x${result.txid.replace(/^0x/, '')}`,
    blockHeight: confirmed.block_height,
    clarityVersion: 4,
    feeMicroStx: fee.toString(),
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    tokenContract: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token',
  };
  writeFileSync('deployments/sbtc-sponsored-transfer-mainnet-v1.json', `${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Mainnet deployment failed.');
  process.exitCode = 1;
});
