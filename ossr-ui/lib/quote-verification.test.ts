import assert from 'node:assert/strict';
import { readStacksAccount } from './stacks-wallet';
import { bufferCV, contractPrincipalCV, hashStructuredData, noneCV, principalCV, signStructuredData, stringAsciiCV, tupleCV, uintCV, privateKeyToPublic, publicKeyToHex, getAddressFromPublicKey, TransactionSigner, deserializeTransaction } from '@stacks/transactions';
import { verifyQuote, validateIntent, type TransferIntent, type QuoteTrust } from './quote-verification';
import { isTerminalChainStatus, extractRawTransaction, prepareWalletContractCall, prepareUnsignedSponsoredTransaction, validateSignedWalletTransaction } from './ossr';
import type { Quote, QuoteResponse } from './ossr';
const privateKey = '1'.padStart(64, '0') + '01';
const origin = 'ST14MZ2VA0731Q6TEPK82FDQNHWKY8NPEMND33NE4';
const sponsor = 'ST2QKEV89ZB3PCW1KC8206FDFJ7F6QANMR22ZG7F5';
const intent: TransferIntent = { relayUrl: 'http://127.0.0.1:3002', origin, recipient: sponsor, amountSats: '100', maxSponsorFeeSats: '10' };
const trust: QuoteTrust = { publicKey: publicKeyToHex(privateKeyToPublic(privateKey)), relayId: 'fixture-relay', keyId: 'fixture-key', policyVersion: 'dev', adapterContract: 'ST2SY3PZHMVQMYN1W4SBJ9MPHW4P8J01ST7TVQ68X.sbtc-sponsored-transfer-v1', sbtcContract: 'SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token', sponsorPrincipal: sponsor };
const quote: Quote = { protocolVersion: '1', quoteId: '0x' + 'ab'.repeat(32), relayId: trust.relayId, network: 'testnet', sponsorPrincipal: sponsor, origin, action: 'sbtc-transfer', reimbursementAsset: { assetId: 'sbtc', contract: trust.sbtcContract, unit: 'sat', decimals: '8' }, adapterContract: trust.adapterContract, functionName: 'sponsored-transfer', argumentsHash: '', sponsorFee: '10', maxNetworkFeeMicroStx: '50000', issuedAtBlock: '100', expiresAtBlock: '110', policyVersion: 'dev', keyId: trust.keyId, signature: '' };
quote.argumentsHash = '0x' + hashStructuredData(tupleCV({ amount: uintCV(100), recipient: principalCV(sponsor), 'sponsor-fee': uintCV(10), 'quote-id': bufferCV(hexToBytes(quote.quoteId)), 'expiry-height': uintCV(110), memo: noneCV() }));
quote.signature = signStructuredData({ message: quoteMessageCV(quote), domain: quoteDomainCV(), privateKey });
const response: QuoteResponse = { quote, quotePublicKey: trust.publicKey };
verifyQuote(response, intent, trust, 101, '110');
for (const field of Object.keys(quote)) {
  const changed = structuredClone(response);
  if (field === 'reimbursementAsset') changed.quote.reimbursementAsset.unit = 'other' as 'sat';
  else (changed.quote as unknown as Record<string, unknown>)[field] = String((quote as unknown as Record<string, unknown>)[field]) + '1';
  assert.throws(() => verifyQuote(changed, intent, trust, 101, '110'), field);
}
for (const field of Object.keys(quote.reimbursementAsset)) {
  const changed = structuredClone(response);
  (changed.quote.reimbursementAsset as unknown as Record<string, unknown>)[field] = 'invalid';
  assert.throws(() => verifyQuote(changed, intent, trust, 101, '110'), field);
}
for (const changed of [{ ...intent, amountSats: '101' }, { ...intent, recipient: origin }, { ...intent, memo: '0x01' }]) assert.throws(() => verifyQuote(response, changed, trust, 101, '110'));
assert.throws(() => verifyQuote(response, intent, trust, 110, '110'));
assert.throws(() => verifyQuote(response, intent, trust, 99, '110'));
assert.throws(() => verifyQuote(response, intent, trust, 101, '109'));
assert.ok(validateIntent({ ...intent, amountSats: '1.5' }).amountSats);
assert.ok(validateIntent({ ...intent, memo: '0x' + 'ff'.repeat(35) }).memo);
assert.equal(isTerminalChainStatus('not_found'), false);
assert.equal(isTerminalChainStatus('dropped_too_expensive'), true);
assert.equal(extractRawTransaction({ txid: 'abc', transaction: 'abcd' }), undefined);
console.log('Quote verification: valid relay format, all signed-field mutations, intent binding, expiry, balance, validation, unknown status passed.');
function splitContractPrincipal(value: string): [string, string] { const [a, b] = value.split('.'); return [a, b]; }
function hexToBytes(value: string) { return Uint8Array.from(value.slice(2).match(/../g) ?? [], byte => parseInt(byte, 16)); }
function quoteDomainCV() {
  return tupleCV({ name: stringAsciiCV('ossr-quote'), version: stringAsciiCV('1'), 'chain-id': uintCV(2147483648n) });
}

function quoteMessageCV(quote: Quote) {
  const [assetAddress, assetName] = splitContractPrincipal(quote.reimbursementAsset.contract);
  const [adapterAddress, adapterName] = splitContractPrincipal(quote.adapterContract);
  return tupleCV({
    'protocol-version': stringAsciiCV(quote.protocolVersion),
    'quote-id': bufferCV(hexToBytes(quote.quoteId)),
    'relay-id': stringAsciiCV(quote.relayId),
    network: stringAsciiCV(quote.network),
    sponsor: principalCV(quote.sponsorPrincipal),
    origin: principalCV(quote.origin),
    action: stringAsciiCV(quote.action),
    'reimbursement-asset': tupleCV({
      'asset-id': stringAsciiCV(quote.reimbursementAsset.assetId),
      contract: contractPrincipalCV(assetAddress, assetName),
      unit: stringAsciiCV(quote.reimbursementAsset.unit),
      decimals: uintCV(BigInt(quote.reimbursementAsset.decimals)),
    }),
    'adapter-contract': contractPrincipalCV(adapterAddress, adapterName),
    'function-name': stringAsciiCV(quote.functionName),
    'arguments-hash': bufferCV(hexToBytes(quote.argumentsHash)),
    'sponsor-fee': uintCV(BigInt(quote.sponsorFee)),
    'max-network-fee-microstx': uintCV(BigInt(quote.maxNetworkFeeMicroStx)),
    'issued-at-block': uintCV(BigInt(quote.issuedAtBlock)),
    'expires-at-block': uintCV(BigInt(quote.expiresAtBlock)),
    'policy-version': stringAsciiCV(quote.policyVersion),
    'key-id': stringAsciiCV(quote.keyId),
  });
}


const signingOrigin = getAddressFromPublicKey(trust.publicKey, 'testnet');
const call = prepareWalletContractCall({ quote: { ...quote, origin: signingOrigin }, recipient: sponsor, amountSats: '100' });
const unsigned = await prepareUnsignedSponsoredTransaction({ call, origin: signingOrigin, publicKey: trust.publicKey, nonce: 0n });
const signed = deserializeTransaction(unsigned);
new TransactionSigner(signed).signOrigin(privateKey);
validateSignedWalletTransaction(signed.serialize(), call, signingOrigin);
assert.throws(() => validateSignedWalletTransaction(signed.serialize(), { ...call, functionName: 'wrong' }, signingOrigin));
assert.throws(() => validateSignedWalletTransaction(signed.serialize(), call, origin));
assert.throws(() => validateSignedWalletTransaction(unsigned, call, signingOrigin));
console.log('Origin-only signing: signature, identity, exact arguments and post-condition checks passed.');

assert.equal(readStacksAccount({ addresses: [{symbol:'STX',address:'SPmainnet'}, {symbol:'STX',address:origin}] })?.address, origin);
assert.equal(readStacksAccount({ addresses: [{symbol:'STX',address:'SPmainnet'}] }), undefined);
