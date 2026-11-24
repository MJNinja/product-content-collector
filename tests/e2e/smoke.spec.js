import { test, expect, openPanel, SITE } from './fixtures.js';

test('extension loads, side panel page renders, panel opens on toolbar click', async ({ context, extensionId }) => {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`${SITE}/index.html`);
  const { panel } = await openPanel(context, extensionId, page);
  await expect(panel.getByRole('tab', { name: 'Projects' })).toBeVisible();
  const behavior = await panel.evaluate(() => chrome.sidePanel.getPanelBehavior());
  expect(behavior.openPanelOnActionClick).toBe(true);
  const manifest = await panel.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.side_panel.default_path).toBe('index.html');
});
