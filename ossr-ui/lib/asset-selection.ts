export type AssetId = 'sbtc' | 'usdcx';

export type AssetOption = {
  value: AssetId;
  label: string;
  unitLabel: string;
  logo: string;
  logoImage?: string;
  logoClass: string;
};

export const assetOptions: readonly AssetOption[] = [
  { value: 'sbtc', label: 'sBTC', unitLabel: 'sats', logo: '₿', logoImage: '/sbtc.avif', logoClass: 'bg-amber-400 text-amber-950' },
  { value: 'usdcx', label: 'USDCx', unitLabel: 'micro-USDCx', logo: 'U', logoImage: '/usdcx.png', logoClass: 'bg-blue-500 text-white' },
];

export function assetConfig(assetId: AssetId): AssetOption {
  if (assetId === 'usdcx') {
    return { value: 'usdcx', label: 'USDCx', unitLabel: 'micro-USDCx', logo: 'U', logoImage: '/usdcx.png', logoClass: 'bg-blue-500 text-white' };
  }
  return { value: 'sbtc', label: 'sBTC', unitLabel: 'sats', logo: '₿', logoImage: '/sbtc.avif', logoClass: 'bg-amber-400 text-amber-950' };
}
