#!/usr/bin/env tsx
import { config as loadEnv } from 'dotenv';
import {
  makeContractCall,
  contractPrincipalCV,
  standardPrincipalCV,
  uintCV,
  bufferCV,
  deserializeTransaction,
  sponsorTransaction,
  broadcastTransaction,
  fetchNonce,
  getAddressFromPrivateKey,
} from '@stacks/transactions';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

const network = 'testnet' as const;
const broadcast = process.argv.includes('--broadcast');

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}; set it in .env.local or env`);
  return value;
}

function nonNegativeInteger(name: string, fallback?: string): bigint {
  const value = process.env[name]?.trim() || fallback;
  if (!value || !/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer.`);
  return BigInt(value);
}

async function main(): Promise<void> {
  const userPrivateKey = required('USER_PRIVATE_KEY');
  const sponsorPrivateKey = required('SPONSOR_PRIVATE_KEY');

  const wrapperAddress = process.env.WRAPPER_CONTRACT_ADDRESS || required('CONTRACT_ADDRESS');
  const wrapperName = process.env.WRAPPER_CONTRACT_NAME || process.env.CONTRACT_NAME || 'reimbursement-wrapper';

  const targetAddress = required('TARGET_CONTRACT_ADDRESS');
  const targetName = required('TARGET_CONTRACT_NAME');

  const operator = required('OPERATOR');
  const protocol = required('PROTOCOL');

  const operatorAmount = nonNegativeInteger('OPERATOR_AMOUNT', '10');
  const protocolAmount = nonNegativeInteger('PROTOCOL_AMOUNT', '2');

  const sponsorFee = nonNegativeInteger('SPONSOR_FEE_MICROSTX', '1000');

  const userAddress = getAddressFromPrivateKey(userPrivateKey, network);
  const sponsorAddress = getAddressFromPrivateKey(sponsorPrivateKey, network);

  // Fetch nonces for origin and sponsor
  const [userNonce, sponsorNonce] = await Promise.all([
    fetchNonce({ address: userAddress, network }),
    fetchNonce({ address: sponsorAddress, network }),
  ]);

  // Build args matching the Clarity contract: (target-contract principal) (operator principal) (protocol principal) (operator-amount uint) (protocol-amount uint) (payload (buff 1024))
  const args = [
    contractPrincipalCV(targetAddress, targetName),
    standardPrincipalCV(operator),
    standardPrincipalCV(protocol),
    uintCV(operatorAmount),
    uintCV(protocolAmount),
    bufferCV(Buffer.from(process.env.PAYLOAD_HEX || '', 'hex')),
  ];

  // Origin signs the sponsored contract-call (sponsored: true, fee 0)
  const originSigned = await makeContractCall({
    contractAddress: wrapperAddress,
    contractName: wrapperName,
    functionName: 'process-and-reimburse',
    functionArgs: args,
    senderKey: userPrivateKey,
    fee: 0n,
    nonce: userNonce,
    sponsored: true,
    network,
  });

  const originBytes = originSigned.serialize();
  const operatorInput = deserializeTransaction(originBytes);

  // Sponsor supplies fee, sponsorNonce and sponsor signature
  const fullySigned = await sponsorTransaction({
    transaction: operatorInput,
    sponsorPrivateKey,
    sponsorNonce,
    fee: sponsorFee,
    network,
  });

  console.log(JSON.stringify({
    network,
    wrapper: `${wrapperAddress}.${wrapperName}`,
    target: `${targetAddress}.${targetName}`,
    userAddress,
    sponsorAddress,
    operator,
    protocol,
    operatorAmount: operatorAmount.toString(),
    protocolAmount: protocolAmount.toString(),
    userNonce: userNonce.toString(),
    sponsorNonce: sponsorNonce.toString(),
    originSignedBytes: originBytes.length / 2,
    fullySignedBytes: fullySigned.serialize().length / 2,
  }, null, 2));

  if (!broadcast) {
    console.log('Dry run completed. Re-run with --broadcast to submit.');
    return;
  }

  const result = await broadcastTransaction({ transaction: fullySigned, network });
  if (!('txid' in result)) throw new Error(`Broadcast rejected: ${JSON.stringify(result)}`);
  console.log(`Broadcast accepted: ${result.txid}`);
  console.log(`Explorer: https://explorer.hiro.so/txid/${result.txid}?chain=testnet`);
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; });
