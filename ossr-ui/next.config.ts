import type { NextConfig } from 'next';
import { createMDX } from 'fumadocs-mdx/next';

const localDevOrigins = process.env.OSSR_ALLOWED_DEV_ORIGINS
  ?.split(',')
  .map(origin => origin.trim())
  .filter(Boolean) ?? [];
const relayProxyUrl = (process.env.OSSR_RELAY_PROXY_URL || 'https://relay.ossr.network').replace(/\/$/, '');

const stacksApiUrl = (process.env.STACKS_API_URL || process.env.NEXT_PUBLIC_STACKS_API_URL || 'https://api.testnet.hiro.so').replace(/\/$/, '');

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '192.168.18.82',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://192.168.18.82:3000',
    ...localDevOrigins,
  ],
  turbopack: {
    root: __dirname,
  },
  async rewrites() {
    return [
      { source: '/relay/:path*', destination: `${relayProxyUrl}/:path*` },
      ...[
        '/extended/v1/address/:address/balances',
        '/extended/v1/address/:address/nonces',
        '/v2/accounts/:address',
        '/v2/info',
      ].map(path => ({ source: `/stacks-api${path}`, destination: `${stacksApiUrl}${path}` })),
    ];
  },
};

export default createMDX()(nextConfig);
