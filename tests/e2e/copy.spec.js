import { join } from 'node:path';
import { test, expect, openPanel, SITE, FIXTURES } from './fixtures.js';

const field = (panel, label) => panel.locator(`[data-field-label="${label}"]`);

async function clickOnPage(page, selector) {
  const element = page.locator(selector).first();
  await element.scrollIntoViewIfNeeded();
  const box = await element.boundingBox();
  const x = box.x + Math.min(box.width / 2, 20);
  const y = box.y + box.height / 2;
  await page.mouse.move(x - 2, y);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
}

test('data of a completed product can be copied to the current one', async ({ context, extensionId }) => {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`${SITE}/index.html`);
  const { panel } = await openPanel(context, extensionId, page);
  await panel.getByTestId('new-project-name').fill('Copy');
  await panel.getByTestId('create-project').click();
  await panel.getByTestId('xlsx-input').setInputFiles(join(FIXTURES, 'sample-products.xlsx'));
  await panel.getByTestId('do-import').click();
  await panel.getByTestId('go-collect').click();

  // The section starts collapsed, with only its title showing.
  const section = panel.getByTestId('copy-from');
  await expect(section).toHaveText(/^\W*Copy from a completed product$/);
  await expect(panel.getByTestId('copy-source')).toHaveCount(0);

  // Product 1: collect a few fields and complete it.
  await panel.getByTestId('open').click();
  await page.waitForURL(`${SITE}/product-1.html`);
  await field(panel, 'Main categories').getByTestId('manual-input').fill('Electronics, Television');
  await field(panel, 'Product title').getByTestId('select-toggle').click();
  await clickOnPage(page, '#title .model');
  await expect(field(panel, 'Product title').getByTestId('selection-item')).toHaveCount(1);
  await field(panel, 'Product description').getByTestId('select-toggle').click();
  await clickOnPage(page, '#specs');
  await page.keyboard.press('Escape');
  await field(panel, 'Main image').getByTestId('select-toggle').click();
  await clickOnPage(page, '#main-image');
  await expect(field(panel, 'Main image').getByTestId('image-url')).toHaveValue(`${SITE}/img/tv1-main.svg`);
  await panel.getByTestId('image-name').fill('UltraView-Red');
  await panel.getByTestId('complete-next').click();
  await page.waitForURL(`${SITE}/product-2.html`);
  await expect(panel.getByTestId('product-counter')).toHaveText('Product 2 of 4');

  // Product 2: copy without images.
  await panel.getByTestId('copy-from-toggle').click();
  await expect(panel.getByTestId('copy-source').locator('option')).toHaveText(['1. TV001']);
  await expect(panel.getByTestId('copy-include-images')).not.toBeChecked();
  await panel.getByTestId('copy-apply').click(); // nothing collected yet: no confirmation
  await expect(panel.getByTestId('banner')).toContainText('from product 1 (TV001)');

  await expect(field(panel, 'Main categories').getByTestId('manual-input')).toHaveValue('Electronics, Television');
  await expect(field(panel, 'Product title').locator('.selection-text')).toHaveText('UltraView 55" 4K Smart TV');
  await expect(field(panel, 'Product description').getByTestId('selection-item')).toHaveCount(1);
  await expect(field(panel, 'Main image').getByTestId('image-item')).toHaveCount(0); // images not copied
  await expect(field(panel, 'SKU').getByTestId('source-value')).toHaveText('TV002'); // spreadsheet field untouched
  await expect(panel.getByTestId('image-name')).toHaveValue(''); // file name not copied
  await expect(panel.locator('.counter-block').getByTestId('status-badge')).toHaveText('In progress');

  // Adjust one value, then copy again including images: asks first, then replaces.
  await field(panel, 'Main categories').getByTestId('manual-input').fill('Audio');
  await panel.getByTestId('copy-include-images').check();
  await panel.getByTestId('copy-apply').click();
  await expect(panel.getByTestId('copy-apply-confirm')).toContainText('Replace current data?');
  await panel.getByTestId('copy-apply-yes').click();
  await expect(field(panel, 'Main categories').getByTestId('manual-input')).toHaveValue('Electronics, Television');
  await expect(field(panel, 'Main image').getByTestId('image-url')).toHaveValue(`${SITE}/img/tv1-main.svg`);
  await expect(panel.getByTestId('image-file-list').locator('code')).toHaveText(['TV002-main.jpg']);

  // The copy belongs to product 2 only: editing it leaves product 1 unchanged.
  await field(panel, 'Product title').getByTestId('sel-remove').click();
  await expect(panel.getByTestId('save-state')).toHaveText('Saved');
  await panel.getByTestId('product-jump').selectOption('0');
  await expect(field(panel, 'Product title').locator('.selection-text')).toHaveText('UltraView 55" 4K Smart TV');
  // The current product is not offered as a source; the section stays open.
  await expect(panel.getByTestId('copy-from')).toContainText('No completed products to copy from yet.');
});
