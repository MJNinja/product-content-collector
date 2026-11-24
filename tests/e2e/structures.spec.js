import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openPanel, SITE, FIXTURES } from './fixtures.js';

const field = (panel, label) => panel.locator(`[data-field-label="${label}"]`);

test('different client structure: URL column detected by content, separate category columns, custom field', async ({ context, extensionId }) => {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`${SITE}/index.html`);
  const { panel } = await openPanel(context, extensionId, page);

  await panel.getByTestId('new-project-name').fill('Client B');
  await panel.getByTestId('create-project').click();
  await panel.getByTestId('xlsx-input').setInputFiles(join(FIXTURES, 'sample-other-structure.xlsx'));
  await expect(panel.getByTestId('sheet-select')).toHaveValue('Catalogue');
  await expect(panel.getByTestId('url-column-select')).toHaveValue('2'); // "Source page"
  await panel.getByTestId('do-import').click();

  // Map subcategories to their own column and add a custom manual "Brand" field in a new column.
  const cards = panel.getByTestId('field-card');
  const subCard = cards.filter({ has: panel.locator('[data-testid="field-label"][value="Subcategories"]') });
  await subCard.getByTestId('field-column').selectOption({ label: 'Sub category' });
  await panel.getByTestId('add-field').click();
  const brand = cards.last();
  await brand.getByTestId('field-label').fill('Brand');
  await brand.getByTestId('field-column').selectOption('__new__');
  await brand.getByTestId('field-column-new-name').fill('Brand');
  await brand.getByTestId('field-column-new-ok').click();
  // Ready-made "Product intro" field can be added to an existing project.
  await panel.getByTestId('add-preset').selectOption('Product intro');
  await expect(cards.last().getByTestId('field-label')).toHaveValue('Product intro');
  await expect(cards.last().getByTestId('field-kind')).toHaveValue('html');
  // Separator for the main category column: pipe
  await panel.getByTestId('section-formatting-toggle').click();
  const mainFmt = panel.getByTestId('format-row').filter({ hasText: 'Main category' });
  await mainFmt.getByTestId('format-separator').fill(' | ');
  await panel.getByTestId('go-collect').click();

  await expect(panel.getByTestId('product-counter')).toHaveText('Product 1 of 2');
  await field(panel, 'Main categories').getByTestId('manual-input').fill('Audio, Home cinema');
  await field(panel, 'Subcategories').getByTestId('manual-input').fill('Soundbars');
  await field(panel, 'Brand').getByTestId('manual-input').fill('SoundCo');
  await panel.getByTestId('next').click();
  await field(panel, 'Main categories').getByTestId('manual-input').fill('TV');
  await expect(panel.getByTestId('save-state')).toHaveText('Saved');

  await panel.getByTestId('tab-export').click();
  const [dl] = await Promise.all([panel.waitForEvent('download'), panel.getByTestId('export-xlsx').click()]);
  const wb = XLSX.read(readFileSync(await dl.path()), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Catalogue, { header: 1, defval: '' });
  expect(rows[0]).toEqual(['Article no.', 'Title', 'Source page', 'Main category', 'Sub category', 'Body HTML', 'Picture', 'Brand']);
  // Main categories field joins its own values with ", "; nothing else maps to that column.
  expect(rows[1].slice(0, 5)).toEqual(['A-1', '', `${SITE}/product-2.html`, 'Audio, Home cinema', 'Soundbars']);
  expect(rows[1][7]).toBe('SoundCo');
  expect(rows[2][3]).toBe('TV');
});

test('pages where scripts cannot run show a clear error', async ({ context, extensionId }) => {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`${SITE}/index.html`);
  const { panel, tabId } = await openPanel(context, extensionId, page);
  await panel.getByTestId('new-project-name').fill('Restricted');
  await panel.getByTestId('create-project').click();
  await panel.getByTestId('xlsx-input').setInputFiles(join(FIXTURES, 'sample-products.xlsx'));
  await panel.getByTestId('do-import').click();
  await panel.getByTestId('go-collect').click();
  await panel.evaluate((id) => chrome.tabs.update(id, { url: 'chrome://version/' }), tabId);
  await expect.poll(() => panel.evaluate((id) => chrome.tabs.get(id).then((t) => t.url), tabId)).toContain('chrome://version');
  await field(panel, 'Product description').getByTestId('select-toggle').click();
  await expect(panel.getByTestId('banner')).toContainText('Chrome does not allow extensions to access this page');
  await expect(field(panel, 'Product description').getByTestId('select-toggle')).toHaveText(/Select on page/);
});
