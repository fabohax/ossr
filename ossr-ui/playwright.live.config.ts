import { defineConfig } from '@playwright/test';
// No injected wallets, mocked requests, fixture builds, or dev server.
export default defineConfig({
  testDir: './live',
  outputDir: 'live-test-results',
  workers: 1,
  reporter: 'list',
  use: { browserName: 'chromium', storageState: process.env.OSSR_LIVE_STORAGE_STATE || undefined },
});
