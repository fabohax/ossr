import { describe, expect, it } from 'vitest';
import {
  AuthType,
  deserializeTransaction,
  getAddressFromPublicKey,
  Pc,
  postConditionToHex,
  serializeCV,
  uintCV,
} from '@stacks/transactions';
import { prepareUnsignedSponsoredTransaction, type PreparedWalletCall } from '../ossr-ui/lib/ossr.js';

describe('Xverse sponsored transaction preparation', () => {
  it('constructs sponsored authorization before asking the wallet to sign', async () => {
    const publicKey = '02d3331cbb9f72fe635e6f87c2cf1a13cdea520f08c0cc68584a96e8ac19d8d304';
    const origin = getAddressFromPublicKey(publicKey, 'testnet');
    const contract = 'ST000000000000000000002AMW42H.example' as const;
    const call: PreparedWalletCall = {
      contract,
      contractAddress: 'ST000000000000000000002AMW42H',
      contractName: 'example',
      functionName: 'transfer',
      functionArgs: [serializeCV(uintCV(1n))],
      postConditions: [postConditionToHex(Pc.principal(origin).willSendEq(1n).ustx())],
      postConditionMode: 'deny',
      sponsored: true,
    };

    const raw = await prepareUnsignedSponsoredTransaction({ call, origin, publicKey, nonce: 7n });
    const transaction = deserializeTransaction(raw);

    expect(transaction.auth.authType).toBe(AuthType.Sponsored);
    expect(transaction.postConditions.values).toHaveLength(1);
    expect(transaction.auth.spendingCondition.nonce).toBe(7n);
  });
});
