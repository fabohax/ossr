export type StacksNetworkName = 'testnet' | 'mainnet';

export function stacksNetworkFromEnv(env: NodeJS.ProcessEnv = process.env): StacksNetworkName {
  const configured = env.STACKS_NETWORK?.trim() || 'testnet';
  if (configured !== 'testnet' && configured !== 'mainnet') {
    throw new Error('STACKS_NETWORK must be testnet or mainnet.');
  }
  return configured;
}

export function stacksApiUrlForNetwork(network: StacksNetworkName, env: NodeJS.ProcessEnv = process.env): string {
  const configured = network === 'mainnet'
    ? env.MAINNET_STACKS_API_URL?.trim() || 'https://stacks-node-api.mainnet.stacks.co'
    : env.STACKS_API_URL?.trim() || 'https://api.testnet.hiro.so';
  let host: string;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    host = url.hostname.toLowerCase();
  } catch {
    throw new Error(`${network === 'mainnet' ? 'MAINNET_STACKS_API_URL' : 'STACKS_API_URL'} must be a public HTTPS Stacks API URL.`);
  }
  if (network === 'mainnet' && host.includes('testnet')) throw new Error('Mainnet relay cannot use a testnet Stacks API.');
  if (network === 'testnet' && host.includes('mainnet')) throw new Error('Testnet relay cannot use a mainnet Stacks API.');
  return configured.replace(/\/$/, '');
}
