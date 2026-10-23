import { describe, expect, it } from 'vitest';
import { Cl } from '@stacks/transactions';

const accounts = simnet.getAccounts();
const deployer = accounts.get('deployer')!;
const wallets = ['wallet_1', 'wallet_2', 'wallet_3'] as const;

const MINT_AMOUNT = 1_000_000n;

describe('mock usdcx token local minting', () => {
  it('mints large balances to test wallets and moves funds between them', () => {
    for (const walletName of wallets) {
      const wallet = accounts.get(walletName)!;

      const mint = simnet.callPublicFn(
        'mock-usdcx-token',
        'mint',
        [Cl.uint(MINT_AMOUNT), Cl.principal(wallet)],
        deployer,
      );

      expect(mint.result).toBeOk(Cl.bool(true));

      const balance = simnet.callReadOnlyFn(
        'mock-usdcx-token',
        'get-balance',
        [Cl.principal(wallet)],
        deployer,
      );

      expect(balance.result).toBeOk(Cl.uint(MINT_AMOUNT));
      console.log(`${walletName}: ${wallet} => ${MINT_AMOUNT.toString()} usdcx`);
    }

    const sender = accounts.get('wallet_1')!;
    const receiver = accounts.get('wallet_2')!;
    const transferAmount = 250_000n;

    const transfer = simnet.callPublicFn(
      'mock-usdcx-token',
      'transfer',
      [Cl.uint(transferAmount), Cl.principal(sender), Cl.principal(receiver), Cl.none()],
      sender,
    );

    expect(transfer.result).toBeOk(Cl.bool(true));

    const senderBalance = simnet.callReadOnlyFn(
      'mock-usdcx-token',
      'get-balance',
      [Cl.principal(sender)],
      deployer,
    );

    const receiverBalance = simnet.callReadOnlyFn(
      'mock-usdcx-token',
      'get-balance',
      [Cl.principal(receiver)],
      deployer,
    );

    expect(senderBalance.result).toBeOk(Cl.uint(MINT_AMOUNT - transferAmount));
    expect(receiverBalance.result).toBeOk(Cl.uint(MINT_AMOUNT + transferAmount));

    console.log(`wallet_1 -> wallet_2 transfer: ${transferAmount.toString()} usdcx`);
  });
});
