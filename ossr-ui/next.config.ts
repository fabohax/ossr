import type { NextConfig } from 'next';
import { createMDX } from 'fumadocs-mdx/next';
import { validateDeploymentConfig } from './scripts/validate-config.mjs';

if (process.env.OSSR_DEPLOYMENT === 'public') {
  const errors = validateDeploymentConfig(process.env);
  if (errors.length) throw new Error(`Invalid public deployment configuration:\n${errors.join('\n')}`);
}

const localDevOrigins = process.env.OSSR_ALLOWED_DEV_ORIGINS
  ?.split(',')
  .map(origin => origin.trim())
  .filter(Boolean) ?? [];
const relayProxyUrl = (process.env.OSSR_RELAY_PROXY_URL || 'https://relay.ossr.network').replace(/\/$/, '');

const stacksApiUrl = (process.env.STACKS_API_URL || process.env.NEXT_PUBLIC_STACKS_API_URL || 'https://api.testnet.hiro.so').replace(/\/$/, '');

const nextConfig: NextConfig = {
  distDir: process.env.OSSR_UI_DIST_DIR || '.next',
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
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Content-Security-Policy', value: [
        "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
        // Static Next pages use inline hydration scripts and wallet UI uses inline styles.
        "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
        "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", "font-src 'self' data:",
        "connect-src 'self' https: wss:" + (process.env.NODE_ENV === 'development' ? ' http: ws:' : ''),
        "frame-src 'self' https: chrome-extension: moz-extension:", "worker-src 'self' blob:",
      ].join('; ') },
    ] }];
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
