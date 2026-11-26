import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
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

async function waitSaved(panel) {
  await expect(panel.getByTestId('save-state')).toHaveText('Saved');
}

test('complete workflow: import → configure → collect → navigate → reopen → export → backup/restore', async ({ context, extensionId }) => {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`${SITE}/index.html`);
  const { panel, tabId } = await openPanel(context, extensionId, page);
  await panel.setViewportSize({ width: 420, height: 1000 }); // side-panel-like width
  const shot = (name) => panel.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

  // 1. Create a project
  await panel.getByTestId('new-project-name').fill('Client A – TVs');
  await panel.getByTestId('create-project').click();

  // 2. Import workbook, worksheet and URL column
  await panel.getByTestId('xlsx-input').setInputFiles(join(FIXTURES, 'sample-products.xlsx'));
  await expect(panel.getByTestId('sheet-select')).toHaveValue('Products');
  await expect(panel.getByTestId('url-column-select')).toHaveValue('1');
  await expect(panel.getByTestId('import-stats')).toContainText('4 data rows · 3 valid URLs');
  // Switching worksheet changes columns; switch back.
  await panel.getByTestId('sheet-select').selectOption('Read me');
  await panel.getByTestId('sheet-select').selectOption('Products');
  await panel.getByTestId('url-column-select').selectOption('1');
  await panel.getByTestId('do-import').click();

  // 3. Field configuration (suggested fields mapped to existing headers)
  await expect(panel.getByTestId('field-card')).toHaveCount(8);
  const labels = await panel.getByTestId('field-label').evaluateAll((els) => els.map((e) => e.value));
  expect(labels).toEqual(['SKU', 'Product title', 'Main categories', 'Subcategories', 'Product intro', 'Product description', 'Main image', 'Gallery images']);
  // Product intro (same setup as the description) goes to a new "Product Intro" column.
  const introCard = panel.getByTestId('field-card').nth(4);
  await expect(introCard.getByTestId('field-method')).toHaveValue('visual');
  await expect(introCard.getByTestId('field-kind')).toHaveValue('html');
  await expect(introCard.getByTestId('field-multiple')).toBeChecked();
  await introCard.getByTestId('field-column').selectOption('__new__');
  await introCard.getByTestId('field-column-new-name').fill('Product Intro');
  await introCard.getByTestId('field-column-new-ok').click();
  // Image fields have no alt/title column options.
  const mainImageCard = panel.getByTestId('field-card').nth(6);
  await expect(mainImageCard.getByTestId('field-image-role')).toHaveValue('main');
  await expect(panel.getByTestId('field-alt-column')).toHaveCount(0);
  await expect(panel.getByTestId('field-title-column')).toHaveCount(0);
  // Rename the "Name" column to "Product Name".
  const nameCol = panel.getByTestId('column-name').nth(3);
  await expect(nameCol).toHaveValue('Name');
  await nameCol.fill('Product Name');
  // Cell formatting starts collapsed.
  await expect(panel.getByTestId('format-row')).toHaveCount(0);
  await panel.getByTestId('section-formatting-toggle').click();
  // Categories: WooCommerce-style hierarchical paths.
  const catFormat = panel.getByTestId('format-row').filter({ hasText: 'Main categories + Subcategories' });
  await catFormat.getByTestId('format-mode').selectOption('prefix');
  // Product identifier for the "jump to product" list: automatic picks SKU.
  const labelCol = panel.getByTestId('label-column');
  await expect(labelCol.locator('option').first()).toHaveText('Automatic (SKU)');
  await labelCol.selectOption('c2');
  await waitSaved(panel);
  await shot('2-fields');
  await panel.getByTestId('go-collect').click();
  const jumpOptions = panel.getByTestId('product-jump').locator('option');
  await expect(jumpOptions.nth(1)).toHaveText('2. Existing category – Pending');
  await expect(jumpOptions.nth(0)).toHaveText(`1. ${SITE}/product-1.html – Pending`); // empty → URL
  await panel.getByTestId('tab-fields').click();
  await panel.getByTestId('label-column').selectOption('__auto__');
  await panel.getByTestId('tab-collect').click();
  await expect(jumpOptions.nth(0)).toHaveText('1. TV001 – Pending');
  await expect(jumpOptions.nth(1)).toHaveText('2. TV002 – Pending');

  // 4. Open first product in the same tab
  await expect(panel.getByTestId('product-counter')).toHaveText('Product 1 of 4');
  // The status badge sits below the counter.
  const counterBox = await panel.getByTestId('product-counter').boundingBox();
  const badgeBox = await panel.locator('.counter-block').getByTestId('status-badge').boundingBox();
  expect(badgeBox.y).toBeGreaterThanOrEqual(counterBox.y + counterBox.height - 1);
  await panel.getByTestId('open').click();
  await page.waitForURL(`${SITE}/product-1.html`);

  // 5/6. Main categories and subcategories (manual)
  await field(panel, 'Main categories').getByTestId('manual-input').fill('Electronics, Television , ,Entertainment');
  await expect(field(panel, 'Main categories').locator('.chip')).toHaveText(['Electronics×', 'Television×', 'Entertainment×']);
  await field(panel, 'Subcategories').getByTestId('manual-input').fill('Smart TVs, 4K TVs');
  await expect(field(panel, 'SKU').getByTestId('source-value')).toHaveText('TV001');

  // Title: visual text, clicking an inline <span> inside the heading selects the heading.
  await field(panel, 'Product title').getByTestId('select-toggle').click();
  await expect(field(panel, 'Product title').getByTestId('select-toggle')).toHaveText(/Stop/);
  await clickOnPage(page, '#title .model');
  await expect(field(panel, 'Product title').getByTestId('selection-item')).toHaveCount(1);
  await expect(field(panel, 'Product title').locator('.selection-text')).toHaveText('UltraView 55" 4K Smart TV');
  // Single-value field: selection mode ends automatically.
  await expect(field(panel, 'Product title').getByTestId('select-toggle')).toHaveText(/Select on page/);

  // Product intro: the intro block, selected the same way as the description.
  const intro = field(panel, 'Product intro');
  await intro.getByTestId('select-toggle').click();
  await clickOnPage(page, '#hdr-link');
  await page.keyboard.press('Escape');
  await expect(intro.getByTestId('selection-item')).toHaveCount(1);
  await expect(intro.getByTestId('output-tag')).toHaveValue('p');

  // 7-9. Description: headings, paragraph-like div (clicking the link inside it), nested list.
  const desc = field(panel, 'Product description');
  await desc.getByTestId('select-toggle').click();
  await expect(desc.getByTestId('select-toggle')).toHaveText(/Stop/);
  await clickOnPage(page, '#features-heading');
  await clickOnPage(page, '#hdr-link'); // inline link → promoted to the intro div; link must not fire
  await clickOnPage(page, '#specs-heading');
  // Hover a nested list item and walk up to the outer list with ↑, then Enter.
  await page.bringToFront();
  const nested = page.locator('#nested li').first();
  const nb = await nested.boundingBox();
  await page.mouse.move(nb.x + 5, nb.y + nb.height / 2);
  await page.keyboard.press('ArrowUp'); // ul#nested
  await page.keyboard.press('ArrowUp'); // li
  await page.keyboard.press('ArrowUp'); // ul#specs
  await page.keyboard.press('Enter');
  await clickOnPage(page, '#warranty-heading');
  await clickOnPage(page, '#warranty');
  await expect(desc.getByTestId('selection-item')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(desc.getByTestId('select-toggle')).toHaveText(/Select on page/);
  // Clicks were swallowed: no navigation, no handlers ran.
  expect(page.url()).toBe(`${SITE}/product-1.html`);
  expect(await page.evaluate(() => [window.__linkClicks, !!window.__introClicked, !!window.__cart])).toEqual([0, false, false]);
  // Outside selection mode the page works normally again.
  await page.evaluate(() => document.getElementById('add-to-cart').click());
  expect(await page.evaluate(() => window.__cart)).toBe(true);

  // 10. Change output tags: H2 → H3 for the two section headings.
  const items = desc.getByTestId('selection-item');
  await expect(items.nth(0).locator('.tag-from')).toHaveText('<h2>');
  await items.nth(0).getByTestId('output-tag').selectOption('h3');
  await items.nth(2).getByTestId('output-tag').selectOption('h3');
  await expect(items.nth(1).getByTestId('output-tag')).toHaveValue('p'); // div with inline content → <p>

  // 11. Reorder: move the warranty paragraph above its heading and back again.
  await items.nth(5).getByTestId('sel-up').click();
  await expect(items.nth(4).locator('.selection-text')).toContainText('Two years');
  await items.nth(4).getByTestId('sel-down').click();
  await expect(items.nth(5).locator('.selection-text')).toContainText('Two years');

  // HTML preview (rendered + source)
  await desc.getByTestId('preview-toggle').click();
  await expect(desc.getByTestId('preview-rendered').locator('h3')).toHaveText(['Product Features', 'Technical Specifications', 'Warranty Information']);
  await expect(desc.getByTestId('preview-rendered').locator('ul ul li')).toHaveText(['HDR10+', 'Dolby Vision']);
  await desc.getByTestId('preview-source').click();
  const source = await desc.getByTestId('preview-source-code').textContent();
  expect(source).toContain('<h3>Product Features</h3>');
  expect(source).toContain('<p>Experience <strong>stunning 4K</strong> clarity with <em>HDR10+</em> and a <a href="http://localhost:4599/hdr">vivid</a> colour engine.</p>');
  expect(source).toMatch(/<ul>\s*<li><b>Screen:<\/b> 55 inch<\/li>/);
  expect(source).toMatch(/<li><b>Resolution:<\/b> 3840 × 2160<ul>\n\s+<li>HDR10\+<\/li>\n\s+<li>Dolby Vision<\/li>\n\s+<\/ul>/);
  expect(source).not.toMatch(/class=|style=|onclick|data-tracking|script|Screen reader only|window\.__evil/);
  expect(source).toContain('<p>Two years <i>manufacturer</i> warranty.</p>');

  // 12. Images: main image (lazy data-src/data-srcset) and gallery (thumbnails linking to full size).
  const mainImg = field(panel, 'Main image');
  await mainImg.getByTestId('select-toggle').click();
  await clickOnPage(page, '#main-image');
  await expect(mainImg.getByTestId('image-url')).toHaveValue(`${SITE}/img/tv1-main.svg`);
  await expect(mainImg.getByTestId('image-alt')).toHaveCount(0);
  const gallery = field(panel, 'Gallery images');
  await gallery.getByTestId('select-toggle').click();
  await clickOnPage(page, '#thumb-1 img');
  await clickOnPage(page, '#thumb-2 img');
  await expect(gallery.getByTestId('image-url')).toHaveCount(2);
  await expect(gallery.getByTestId('image-url').nth(0)).toHaveValue(`${SITE}/img/tv1-g1.svg`);
  await expect(gallery.getByTestId('image-url').nth(1)).toHaveValue(`${SITE}/img/tv1-g2.svg`);
  await gallery.getByTestId('select-toggle').click(); // stop from the panel
  await expect(gallery.getByTestId('select-toggle')).toHaveText(/Select image/);
  expect(page.url()).toBe(`${SITE}/product-1.html`);
  expect(await page.evaluate(() => window.__linkClicks)).toBe(0);

  // Combined cell preview
  const preview = panel.getByTestId('row-preview');
  await expect(preview.locator('tr[data-column="Categories"] pre')).toHaveText(
    'Electronics > Television > Entertainment > Smart TVs, Electronics > Television > Entertainment > 4K TVs',
  );
  await expect(preview.locator('tr[data-column="Images"] pre')).toHaveText(
    `${SITE}/img/tv1-main.svg, ${SITE}/img/tv1-g1.svg, ${SITE}/img/tv1-g2.svg`,
  );

  await shot('3-collect');
  await page.screenshot({ path: 'test-results/screens/3-page-selecting.png' });

  // 13/14. Save and go to next product
  await panel.getByTestId('complete-next').click();
  await page.waitForURL(`${SITE}/product-2.html`);
  await expect(panel.getByTestId('product-counter')).toHaveText('Product 2 of 4');
  // New product starts empty
  await expect(field(panel, 'Main categories').getByTestId('manual-input')).toHaveValue('');
  await expect(field(panel, 'Product description').getByTestId('selection-item')).toHaveCount(0);
  await expect(field(panel, 'SKU').getByTestId('source-value')).toHaveText('TV002');

  // 16. Different categories for product 2
  await field(panel, 'Main categories').getByTestId('manual-input').fill('Electronics');
  await field(panel, 'Subcategories').getByTestId('manual-input').fill('Audio, Speakers');
  await field(panel, 'Product title').getByTestId('select-toggle').click();
  await clickOnPage(page, '#title2');
  await expect(field(panel, 'Product title').locator('.selection-text')).toHaveText('SoundBar Pro 300');
  const desc2 = field(panel, 'Product description');
  await desc2.getByTestId('select-toggle').click();
  await clickOnPage(page, '#about2');
  await clickOnPage(page, '#desc2 p:last-child');
  await expect(desc2.getByTestId('selection-item')).toHaveCount(2);
  // Re-arm selection after navigation: reload the page while selecting, keep selecting.
  await page.reload();
  await page.waitForLoadState('load');
  await expect(desc2.getByTestId('select-toggle')).toHaveText(/Stop/);
  // The panel re-injects the content script and re-starts selection mode.
  await expect
    .poll(() => panel.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'pcc:ping' }).then((r) => r.selecting, () => false), tabId))
    .toBe(true);
  const li = await page.locator('#steps2 li').first().boundingBox();
  await page.mouse.move(li.x + 10, li.y + li.height / 2);
  await page.keyboard.press('ArrowUp'); // list item → whole <ol>
  await page.keyboard.press('Enter');
  await expect(desc2.getByTestId('selection-item')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(desc2.getByTestId('selection-item').nth(2).locator('.tag-from')).toHaveText('<ol>');
  await field(panel, 'Main image').getByTestId('select-toggle').click();
  await clickOnPage(page, '#main2');
  await expect(field(panel, 'Main image').getByTestId('image-url')).toHaveValue(`${SITE}/img/tv2-main.svg`);
  await field(panel, 'Gallery images').getByTestId('select-toggle').click();
  await clickOnPage(page, '#gallery2');
  await page.keyboard.press('Escape');

  // 15. Previous product data is intact
  await panel.getByTestId('prev').click();
  await page.waitForURL(`${SITE}/product-1.html`);
  await expect(panel.getByTestId('product-counter')).toHaveText('Product 1 of 4');
  await expect(field(panel, 'Main categories').getByTestId('manual-input')).toHaveValue('Electronics, Television , ,Entertainment');
  await expect(field(panel, 'Subcategories').getByTestId('manual-input')).toHaveValue('Smart TVs, 4K TVs');
  await expect(field(panel, 'Product description').getByTestId('selection-item')).toHaveCount(6);
  await expect(field(panel, 'Gallery images').getByTestId('image-url')).toHaveCount(2);
  await expect(panel.getByTestId('status-badge')).toHaveText('Completed');

  // 17. Process more products: product 2 complete, product 3 (background image, inline <font>), skip 4
  await panel.getByTestId('product-jump').selectOption('1');
  await page.waitForURL(`${SITE}/product-2.html`);
  await expect(field(panel, 'Subcategories').getByTestId('manual-input')).toHaveValue('Audio, Speakers');
  await panel.getByTestId('complete-next').click();
  await page.waitForURL(`${SITE}/product-3.html`);
  await field(panel, 'Main categories').getByTestId('manual-input').fill('Appliances');
  await field(panel, 'Subcategories').getByTestId('manual-input').fill('Refrigeration');
  await field(panel, 'Main image').getByTestId('select-toggle').click();
  await clickOnPage(page, '#bg3');
  await expect(field(panel, 'Main image').getByTestId('image-url')).toHaveValue(`${SITE}/img/tv3-main.svg`);
  // Required title missing → completing is refused with a clear message.
  await panel.getByTestId('complete').click();
  await expect(panel.getByTestId('banner')).toContainText('Required field(s) empty: Product title');
  // Manually override the SKU of product 3 (source field edit)
  await field(panel, 'SKU').getByTestId('source-edit').click();
  await field(panel, 'SKU').getByTestId('source-input').fill('TV003-NEW');
  await panel.getByTestId('skip').click();
  await expect(panel.getByTestId('product-counter')).toHaveText('Product 4 of 4');
  await expect(panel.getByTestId('banner')).toContainText('no valid product URL');
  await expect(panel.getByTestId('product-url')).toContainText('No valid URL');
  await field(panel, 'Main categories').getByTestId('manual-input').fill('Manual only');
  await waitSaved(panel);

  // 18. Close and reopen the panel: project and data restored from IndexedDB
  await panel.close();
  const { panel: panel2 } = await openPanel(context, extensionId, page);
  await expect(panel2.getByTestId('product-counter')).toHaveText('Product 4 of 4');
  await expect(field(panel2, 'Main categories').getByTestId('manual-input')).toHaveValue('Manual only');
  await panel2.getByTestId('product-jump').selectOption('0');
  await expect(field(panel2, 'Product description').getByTestId('selection-item')).toHaveCount(6);
  await expect(field(panel2, 'Product description').getByTestId('output-tag').first()).toHaveValue('h3');
  await panel2.getByTestId('product-jump').selectOption('2');
  await expect(panel2.getByTestId('status-badge')).toHaveText('Skipped');
  await expect(field(panel2, 'SKU').getByTestId('source-input')).toHaveValue('TV003-NEW');

  // 19. Export
  await panel2.getByTestId('tab-export').click();
  await panel2.screenshot({ path: 'test-results/screens/4-export.png' });
  await expect(panel2.getByTestId('export-stats')).toContainText('Completed2');
  const [download] = await Promise.all([panel2.waitForEvent('download'), panel2.getByTestId('export-xlsx').click()]);
  expect(download.suggestedFilename()).toBe('sample-products-export.xlsx');
  const exported = readFileSync(await download.path());

  // 20. Reopen exported workbook and verify
  const wb = XLSX.read(exported, { type: 'buffer' });
  expect(wb.SheetNames).toEqual(['Read me', 'Products']);
  expect(XLSX.utils.sheet_to_json(wb.Sheets['Read me'], { header: 1 })).toEqual([
    ['Products are on the "Products" sheet.'],
    ['Do not delete this sheet.'],
  ]);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Products, { header: 1, defval: '' });
  expect(rows[0]).toEqual(['SKU', 'Product URL', 'Categories', 'Product Name', 'Description', 'Images', 'Stock', 'Supplier', 'Product Intro']);
  const [r1, r2, r3, r4] = rows.slice(1);
  expect(r1[0]).toBe('TV001');
  expect(r1[2]).toBe('Electronics > Television > Entertainment > Smart TVs, Electronics > Television > Entertainment > 4K TVs');
  expect(r1[3]).toBe('UltraView 55" 4K Smart TV');
  expect(r1[4].split('\n')[0]).toBe('<h3>Product Features</h3>');
  expect(r1[4]).toContain('<h3>Technical Specifications</h3>\n<ul><li><b>Screen:</b> 55 inch</li><li><b>Resolution:</b> 3840 × 2160<ul><li>HDR10+</li><li>Dolby Vision</li></ul></li><li><b>Smart platform:</b> OpenOS</li></ul>');
  expect(r1[4]).toContain('<h3>Warranty Information</h3>\n<p>Two years <i>manufacturer</i> warranty.</p>');
  expect(r1[5]).toBe(`${SITE}/img/tv1-main.svg, ${SITE}/img/tv1-g1.svg, ${SITE}/img/tv1-g2.svg`);
  expect(r1.slice(6, 8)).toEqual([12, 'ACME']);
  expect(r1[8]).toBe('<p>Experience <strong>stunning 4K</strong> clarity with <em>HDR10+</em> and a <a href="http://localhost:4599/hdr">vivid</a> colour engine.</p>');
  expect(r1).toHaveLength(9);
  expect(r2[2]).toBe('Electronics > Audio, Electronics > Speakers');
  expect(r2[3]).toBe('SoundBar Pro 300');
  expect(r2[4]).toBe('<h4>About this item</h4>\n<p>Wireless subwoofer included.</p>\n<ol><li>Unbox</li><li>Connect HDMI</li></ol>');
  expect(r2[5]).toBe(`${SITE}/img/tv2-main.svg, ${SITE}/img/tv2-g1.svg`);
  expect(r2[8]).toBe(''); // no intro selected for product 2
  expect(r3[0]).toBe('TV003-NEW');
  expect(r3[2]).toBe('Appliances > Refrigeration');
  expect(r3[3]).toBe(''); // title never captured → existing (empty) cell kept
  expect(r4[1]).toBe('not a url');
  expect(r4[2]).toBe('Manual only');
  expect(r4[6]).toBe(1);
  // HTML cells are strings, never formulas.
  const raw = XLSX.read(exported, { type: 'buffer', cellFormula: true }).Sheets.Products.E2;
  expect(raw.t).toBe('s');
  expect(raw.f).toBeUndefined();

  // Backup, delete (with confirmation), restore
  await panel2.getByTestId('tab-projects').click();
  const [backupDl] = await Promise.all([panel2.waitForEvent('download'), panel2.getByTestId('backup-project').click()]);
  const backupPath = await backupDl.path();
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  expect(backup.products).toHaveLength(4);
  await panel2.getByTestId('delete-project').click();
  await expect(panel2.getByTestId('delete-project-confirm')).toContainText('Delete permanently?');
  await panel2.getByTestId('delete-project-yes').click();
  await expect(panel2.getByTestId('project-item')).toHaveCount(0);
  await panel2.getByTestId('restore-input').setInputFiles(backupPath);
  await expect(panel2.getByTestId('project-item')).toHaveCount(1);
  await expect(panel2.getByTestId('project-item')).toContainText('Client A – TVs');
  await expect(panel2.getByTestId('project-item')).toContainText('4 products · 2 completed · 1 skipped');
  await panel2.getByTestId('open-project').click();
  await panel2.getByTestId('product-jump').selectOption('1');
  await expect(field(panel2, 'Subcategories').getByTestId('manual-input')).toHaveValue('Audio, Speakers');
});
