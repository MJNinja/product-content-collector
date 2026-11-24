import { test as base, chromium, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DIST = fileURLToPath(new URL('../../dist', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url));
export const SITE = 'http://localhost:4599';

/**
 * Launches Chromium with the built extension loaded (unpacked, as in Chrome
 * developer mode). The side panel page is driven as a normal tab with
 * ?tabId=<product tab> so it targets the product tab exactly like the real
 * side panel targets the active tab.
 */
export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  userDataDir: async ({}, use) => {
    await use(mkdtempSync(join(tmpdir(), 'pcc-e2e-')));
  },
  context: async ({ userDataDir }, use) => {
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: !process.env.HEADED,
      acceptDownloads: true,
      viewport: { width: 1200, height: 900 },
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw.url().split('/')[2]);
  },
});

export async function openPanel(context, extensionId, productPage) {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/index.html`);
  const tabId = await panel.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.url && t.url.startsWith(url)).id;
  }, productPage.url());
  await panel.goto(`chrome-extension://${extensionId}/index.html?tabId=${tabId}`);
  return { panel, tabId };
}

export { expect };
