export type StacksNetworkName = 'mainnet' | 'testnet';

export const stacksNetwork: StacksNetworkName = process.env.NEXT_PUBLIC_OSSR_NETWORK === 'mainnet'
  ? 'mainnet'
  : 'testnet';

export const stacksNetworkLabel = stacksNetwork === 'mainnet' ? 'Stacks mainnet' : 'Stacks testnet';
export const explorerChain = stacksNetwork;

export function isAddressForNetwork(address: string, network: StacksNetworkName = stacksNetwork): boolean {
  return network === 'mainnet' ? /^(SP|SM)/.test(address) : /^(ST|SN)/.test(address);
}

export function isStandardAddressForNetwork(address: string, network: StacksNetworkName = stacksNetwork): boolean {
  return network === 'mainnet' ? /^SP/.test(address) : /^ST/.test(address);
}

export function configuredSbtcContract(): string {
  return process.env.NEXT_PUBLIC_OSSR_SBTC_CONTRACT
    || (stacksNetwork === 'mainnet'
      ? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token'
      : 'SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token');
}

export function configuredAdapterContract(): string {
  return process.env.NEXT_PUBLIC_OSSR_ADAPTER_CONTRACT
    || (stacksNetwork === 'mainnet'
      ? 'SP17M2KWEK37A5MPDTMWGXJFGJCY41JVQKVK828TQ.sbtc-sponsored-transfer-mainnet-v1'
      : 'ST2SY3PZHMVQMYN1W4SBJ9MPHW4P8J01ST7TVQ68X.sbtc-sponsored-transfer-v1');
}
