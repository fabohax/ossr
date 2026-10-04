import { describe, expect, it } from 'vitest';
import { approvedWalletProviderIds, readStacksAddress, requiresPrebuiltSponsoredTransaction } from '../ossr-ui/lib/stacks-wallet.js';

describe('readStacksAddress', () => {
  it('accepts an Xverse wallet_connect address without a symbol', () => {
    expect(readStacksAddress({
      addresses: [
        { address: 'tb1qexample', publicKey: 'btc-key' },
        { address: 'ST123EXAMPLE', publicKey: 'stx-key' },
      ],
    })).toBe('ST123EXAMPLE');
  });

  it('accepts the wrapped JSON-RPC response shape', () => {
    expect(readStacksAddress({
      result: { addresses: [{ symbol: 'STX', address: 'ST123EXAMPLE' }] },
    })).toBe('ST123EXAMPLE');
  });

  it('rejects a mainnet-only account', () => {
    expect(readStacksAddress({ result: { addresses: [{ symbol: 'STX', address: 'SP123EXAMPLE' }] } })).toBeUndefined();
  });

  it('does not mistake a Bitcoin address for a Stacks address', () => {
    expect(readStacksAddress({ addresses: [{ address: 'bc1qexample' }] })).toBeUndefined();
  });

  it('only offers wallets supported by the OSSR signing flows', () => {
    expect(approvedWalletProviderIds).toEqual([
      'LeatherProvider',
      'XverseProviders.BitcoinProvider',
    ]);
    expect(approvedWalletProviderIds).not.toContain('AsignaProvider');
    expect(approvedWalletProviderIds).not.toContain('FordefiProviders.UtxoProvider');
  });

  it('uses prebuilt sponsored transactions for Xverse and Fordefi', () => {
    expect(requiresPrebuiltSponsoredTransaction('XverseProviders.BitcoinProvider')).toBe(true);
    expect(requiresPrebuiltSponsoredTransaction('FordefiProviders.UtxoProvider')).toBe(true);
    expect(requiresPrebuiltSponsoredTransaction('LeatherProvider')).toBe(false);
  });
});
