import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: 'test-results',
  webServer: {
    command: 'node tests/fixtures/server.js',
    url: 'http://localhost:4599/index.html',
    reuseExistingServer: true,
    timeout: 20_000,
  },
});
