import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: 2,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: ['chromium', 'firefox', 'webkit'].flatMap(browserName => [390, 1440].map(width => ({
    name: `${browserName}-${width}`,
    use: { browserName: browserName as 'chromium' | 'firefox' | 'webkit', viewport: { width, height: 900 } },
  }))),
  webServer: { command: 'npm run start -- --hostname 127.0.0.1 --port 3100', url: 'http://127.0.0.1:3100/dashboard', reuseExistingServer: false },
});
