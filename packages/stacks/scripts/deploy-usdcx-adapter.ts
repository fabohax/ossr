import { config } from 'dotenv';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { broadcastTransaction, ClarityVersion, estimateTransactionByteLength, fetchNonce, getAddressFromPrivateKey, makeContractDeploy, makeSTXTokenTransfer } from '@stacks/transactions';

config({ path: '.env.local', quiet: true });
config({ quiet: true });
const network = 'testnet' as const;
const apiUrl = (process.env.STACKS_API_URL ?? 'https://api.testnet.hiro.so').replace(/\/$/, '');
const client = { baseUrl: apiUrl };
const name = 'usdcx-sponsored-transfer-v1';
const source = readFileSync('contracts/usdcx-sponsored-transfer-v1.clar', 'utf8');
function required(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`Missing ${name}`); return value; }
async function wait(txid: string) {
  for (let attempt = 0; attempt < 180; attempt++) {
    const response = await fetch(`${apiUrl}/extended/v1/tx/0x${txid.replace(/^0x/, '')}`);
    if (response.ok) {
      const body = await response.json() as { tx_status: string; block_height?: number };
      if (body.tx_status === 'success') return body;
      if (body.tx_status !== 'pending') throw new Error(`Transaction ${txid}: ${body.tx_status}`);
    } else if (response.status !== 404) throw new Error(`Transaction lookup HTTP ${response.status}`);
    if (attempt % 4 === 0) console.log(JSON.stringify({ event: 'deployment.waiting', txid }));
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  throw new Error(`Confirmation timeout for ${txid}; check this transaction before retrying.`);
}
async function main() {
  const key = required('PROTOCOL_PRIVATE_KEY');
  const address = getAddressFromPrivateKey(key, network);
  const contract = `${address}.${name}`;
  const existing = await fetch(`${apiUrl}/v2/contracts/source/${address}/${name}`);
  if (existing.ok) {
    const body = await existing.json() as { source: string };
    if (body.source !== source) throw new Error('Existing contract source differs; do not reuse this name.');
    console.log(JSON.stringify({ event: 'deployment.already_exists', contract }));
    return;
  }
  if (existing.status !== 404) throw new Error(`Contract lookup HTTP ${existing.status}`);
  const feeResponse = await fetch(`${apiUrl}/v2/fees/transfer`);
  if (!feeResponse.ok) throw new Error('Cannot estimate deployment fee.');
  const rate = BigInt((await feeResponse.text()).trim());
  if (rate <= 0n) throw new Error('Invalid fee rate.');
  const nonce = await fetchNonce({ address, network, client });
  let tx = await makeContractDeploy({ senderKey: key, contractName: name, codeBody: source, clarityVersion: ClarityVersion.Clarity4, network, nonce, fee: 0n });
  const fee = rate * BigInt(estimateTransactionByteLength(tx)) * 2n;
  if (fee > 10000n) throw new Error(`Deployment fee ${fee} exceeds 10000 microSTX funding allowance.`);
  tx = await makeContractDeploy({ senderKey: key, contractName: name, codeBody: source, clarityVersion: ClarityVersion.Clarity4, network, nonce, fee });
  const balanceResponse = await fetch(`${apiUrl}/extended/v1/address/${address}/stx`);
  if (!balanceResponse.ok) throw new Error('Cannot read deployer balance.');
  const balance = BigInt((await balanceResponse.json() as { balance: string }).balance);
  console.log(JSON.stringify({ event: 'deployment.prepared', contract, nonce: nonce.toString(), feeMicroStx: fee.toString(), balanceMicroStx: balance.toString() }));
  if (!process.argv.includes('--broadcast')) return;
  if (balance < fee) {
    const sponsorKey = required('SPONSOR_PRIVATE_KEY');
    const sponsor = getAddressFromPrivateKey(sponsorKey, network);
    const funding = await makeSTXTokenTransfer({ senderKey: sponsorKey, recipient: address, amount: 10000n, fee: 1000n, nonce: await fetchNonce({ address: sponsor, network, client }), network });
    const result = await broadcastTransaction({ transaction: funding, network, client });
    if (!('txid' in result)) throw new Error(`Funding rejected: ${JSON.stringify(result)}`);
    console.log(JSON.stringify({ event: 'deployment.funding', txid: result.txid, amountMicroStx: '10000' }));
    await wait(result.txid);
  }
  const result = await broadcastTransaction({ transaction: tx, network, client });
  if (!('txid' in result)) throw new Error(`Deployment rejected: ${JSON.stringify(result)}`);
  console.log(JSON.stringify({ event: 'deployment.broadcast', contract, txid: result.txid }));
  const confirmed = await wait(result.txid);
  const published = await fetch(`${apiUrl}/v2/contracts/source/${address}/${name}`);
  if (!published.ok || (await published.json() as { source: string }).source !== source) throw new Error('Published source verification failed.');
  mkdirSync('deployments', { recursive: true });
  const manifest = { network, contract, transactionId: `0x${result.txid.replace(/^0x/, '')}`, blockHeight: confirmed.block_height, clarityVersion: 4, feeMicroStx: fee.toString(), sourceSha256: createHash('sha256').update(source).digest('hex') };
  writeFileSync('deployments/usdcx-testnet.json', `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ event: 'deployment.verified', ...manifest }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Deployment failed.'); process.exitCode = 1; });
