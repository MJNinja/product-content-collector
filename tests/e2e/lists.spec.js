import { join } from 'node:path';
import { test, expect, openPanel, SITE, FIXTURES } from './fixtures.js';

const field = (panel, label) => panel.locator(`[data-field-label="${label}"]`);

async function clickOnPage(page, selector) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  const x = box.x + Math.min(box.width / 2, 20);
  const y = box.y + box.height / 2;
  await page.mouse.move(x - 2, y);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
}

test('selections can be turned into ul / ol lists', async ({ context, extensionId }) => {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`${SITE}/index.html`);
  const { panel } = await openPanel(context, extensionId, page);
  await panel.getByTestId('new-project-name').fill('Lists');
  await panel.getByTestId('create-project').click();
  await panel.getByTestId('xlsx-input').setInputFiles(join(FIXTURES, 'sample-products.xlsx'));
  await panel.getByTestId('do-import').click();
  // The option is also available per field in the Fields tab.
  const introCard = panel.getByTestId('field-card').filter({ has: panel.locator('[data-testid="field-label"][value="Product intro"]') });
  await expect(introCard.getByTestId('field-capture-mode')).toHaveValue('items');
  await panel.getByTestId('go-collect').click();
  await panel.getByTestId('open').click();
  await page.waitForURL(`${SITE}/product-1.html`);

  // 1. "Clicks build one bullet list": every click adds <li> items to the same list.
  const desc = field(panel, 'Product description');
  await desc.getByTestId('capture-mode').selectOption('ul');
  await desc.getByTestId('select-toggle').click();
  await expect(page.locator('pcc-selector-overlay')).toHaveCount(1);
  await clickOnPage(page, '#highlights p:nth-child(1)');
  await clickOnPage(page, '#highlights p:nth-child(2)');
  await clickOnPage(page, '#highlights div');
  await clickOnPage(page, '#lines'); // one element with <br> lines → one item per line
  await expect(desc.getByTestId('selection-item')).toHaveCount(1);
  const listItem = desc.getByTestId('selection-item').first();
  await expect(listItem.locator('.selection-text code')).toHaveText(
    '<ul><li>7.2 channels</li><li>95 watts per channel</li><li>8K Ultra HD</li><li>3D Audio</li><li>Powered by <b>HEOS™</b></li><li>6 HDMI inputs</li></ul>',
  );
  // Selecting a whole container also turns everything inside into list items.
  await page.keyboard.press('Escape');
  await desc.getByTestId('capture-mode').selectOption('ol');
  await desc.getByTestId('select-toggle').click();
  await clickOnPage(page, '#highlights p:nth-child(1)');
  await page.keyboard.press('ArrowUp'); // whole #highlights block
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  // The click on the first paragraph started a new numbered list; the container was added to it.
  await expect(desc.getByTestId('selection-item').nth(1).locator('.selection-text code')).toHaveText(
    '<ol><li>7.2 channels</li><li>7.2 channels</li><li>95 watts per channel</li><li>8K Ultra HD</li></ol>',
  );
  await expect(desc.getByTestId('selection-item')).toHaveCount(2);

  // 2. Separate items, then tick them and merge into a numbered list.
  await desc.getByTestId('sel-clear').click();
  await desc.getByTestId('capture-mode').selectOption('items');
  await desc.getByTestId('select-toggle').click();
  await clickOnPage(page, '#features-heading');
  await clickOnPage(page, '#highlights p:nth-child(1)');
  await clickOnPage(page, '#highlights p:nth-child(2)');
  await clickOnPage(page, '#lines');
  await page.keyboard.press('Escape');
  const items = desc.getByTestId('selection-item');
  await expect(items).toHaveCount(4);
  await items.nth(1).getByTestId('sel-check').check();
  await items.nth(2).getByTestId('sel-check').check();
  await items.nth(3).getByTestId('sel-check').check();
  await expect(desc.getByTestId('list-bar')).toContainText('3 ticked');
  await desc.getByTestId('make-ol').click();
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).locator('.selection-text code')).toHaveText('<h2>Product Features</h2>');
  await expect(items.nth(1).locator('.selection-text code')).toHaveText(
    '<ol><li>7.2 channels</li><li>95 watts per channel</li><li>3D Audio</li><li>Powered by <b>HEOS™</b></li><li>6 HDMI inputs</li></ol>',
  );
  await expect(items.nth(1).getByTestId('output-tag')).toHaveValue('keep');
  // The list can still be switched between ul and ol with the output tag.
  await items.nth(1).getByTestId('output-tag').selectOption('ul');
  await desc.getByTestId('preview-toggle').click();
  await expect(desc.getByTestId('preview-rendered').locator('ul > li')).toHaveCount(5);
  await expect(panel.getByTestId('row-preview').locator('tr[data-column="Description"] pre')).toHaveText(
    '<h2>Product Features</h2>\n<ul><li>7.2 channels</li><li>95 watts per channel</li><li>3D Audio</li><li>Powered by <b>HEOS™</b></li><li>6 HDMI inputs</li></ul>',
  );

  // 3. Works for the Product intro field too, and the setting is remembered.
  const intro = field(panel, 'Product intro');
  await intro.getByTestId('capture-mode').selectOption('ul');
  await intro.getByTestId('select-toggle').click();
  await clickOnPage(page, '#lines');
  await page.keyboard.press('Escape');
  await expect(intro.getByTestId('selection-item').first().locator('.selection-text code')).toHaveText(
    '<ul><li>3D Audio</li><li>Powered by <b>HEOS™</b></li><li>6 HDMI inputs</li></ul>',
  );
  await panel.getByTestId('tab-fields').click();
  await expect(introCard.getByTestId('field-capture-mode')).toHaveValue('ul');
});
