import * as XLSX from 'xlsx';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/** Lists a zip (python's zipfile verifies CRCs) and extracts it. */
function unzip(zipPath) {
  const dir = mkdtempSync(join(tmpdir(), 'pcc-unzip-'));
  const names = execFileSync('python3', ['-c', `
import zipfile,sys
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; z.extractall(sys.argv[2])
print("\\n".join(z.namelist()))`, zipPath, dir]).toString().trim().split('\n');
  return { dir, names };
}

test('edited description HTML has no added <div>; images are renamed, resized, converted and zipped', async ({ context, extensionId }) => {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`${SITE}/index.html`);
  const { panel } = await openPanel(context, extensionId, page);

  await panel.getByTestId('new-project-name').fill('Images');
  await panel.getByTestId('create-project').click();
  await panel.getByTestId('xlsx-input').setInputFiles(join(FIXTURES, 'sample-products.xlsx'));
  await panel.getByTestId('do-import').click();
  await panel.getByTestId('go-collect').click();
  await panel.getByTestId('open').click();
  await page.waitForURL(`${SITE}/product-1.html`);

  // --- Editing a description selection never wraps it in <div> -------------
  const desc = field(panel, 'Product description');
  await desc.getByTestId('select-toggle').click();
  await clickOnPage(page, '#specs');
  await page.keyboard.press('Escape');
  const item = desc.getByTestId('selection-item').first();
  await item.getByTestId('sel-edit-toggle').click();
  const edit = item.getByTestId('sel-edit');
  await expect(edit).toHaveValue(/^<ul><li><b>Screen:<\/b> 55 inch<\/li>/);
  const edited = '<li>7.2 channels</li><li>95 watts per channel</li><li>8K Ultra HD</li><li>Powered by HEOS™</li>';
  await edit.fill(edited);
  await edit.blur();
  await item.getByTestId('sel-edit-toggle').click();
  await expect(item.locator('.selection-text code')).toHaveText(edited);
  await expect(item.getByTestId('output-tag')).toHaveValue('keep');
  await expect(item.getByTestId('output-tag').locator('option[value="keep"]')).toHaveText('keep as is');
  // Re-open the editor: still exactly what was typed.
  await item.getByTestId('sel-edit-toggle').click();
  await expect(item.getByTestId('sel-edit')).toHaveValue(edited);
  await item.getByTestId('sel-edit-toggle').click();

  // --- Images ------------------------------------------------------------
  await field(panel, 'Main image').getByTestId('select-toggle').click();
  await clickOnPage(page, '#main-image');
  await expect(field(panel, 'Main image').getByTestId('image-url')).toHaveValue(`${SITE}/img/tv1-main.svg`);
  const gallery = field(panel, 'Gallery images');
  await gallery.getByTestId('select-toggle').click();
  await clickOnPage(page, '#thumb-1 img');
  await page.keyboard.press('Escape');
  // Add a large transparent PNG and a broken URL by pasting.
  const paste = gallery.locator('form input');
  await paste.fill(`${SITE}/img/big-front.png?sw=3000`);
  await paste.press('Enter');
  await paste.fill(`${SITE}/img/missing.png`);
  await paste.press('Enter');
  await expect(gallery.getByTestId('image-url')).toHaveCount(3);

  // File names are based on the SKU column by default.
  await expect(panel.getByTestId('image-name')).toHaveAttribute('placeholder', 'TV001');
  await expect(panel.getByTestId('image-file-list').locator('code')).toHaveText(['TV001-main.jpg', 'TV001-1.jpg', 'TV001-2.jpg', 'TV001-3.jpg']);

  // Product 2: custom file name.
  await panel.getByTestId('next').click();
  await page.waitForURL(`${SITE}/product-2.html`);
  await field(panel, 'Main image').getByTestId('select-toggle').click();
  await clickOnPage(page, '#main2');
  await expect(field(panel, 'Main image').getByTestId('image-url')).toHaveValue(`${SITE}/img/tv2-main.svg`);
  await panel.getByTestId('image-name').fill('SoundBar Pro 300');
  await expect(panel.getByTestId('image-file-list').locator('code')).toHaveText(['SoundBar-Pro-300-main.jpg']);

  // --- Image settings live in the Fields tab (collapsible sections) ---------
  await panel.getByTestId('tab-fields').click();
  // Sections collapse to a one-line summary and remember their state.
  await panel.getByTestId('section-columns-toggle').click();
  await expect(panel.getByTestId('column-item')).toHaveCount(0);
  await expect(panel.getByTestId('section-columns')).toContainText('8 columns');
  await panel.getByTestId('section-fields-toggle').click();
  await expect(panel.getByTestId('field-card')).toHaveCount(0);
  await expect(panel.getByTestId('section-fields')).toContainText('8 fields: SKU, Product title');
  await panel.getByTestId('tab-collect').click();
  await panel.getByTestId('tab-fields').click();
  await expect(panel.getByTestId('field-card')).toHaveCount(0); // still collapsed
  await panel.getByTestId('section-fields-toggle').click();
  await expect(panel.getByTestId('field-card')).toHaveCount(8);
  await panel.getByTestId('section-columns-toggle').click();
  await expect(panel.getByTestId('column-item')).toHaveCount(8);
  // Export tab no longer holds the settings.
  await panel.getByTestId('tab-export').click();
  await expect(panel.getByTestId('image-base-url')).toHaveCount(0);
  await panel.getByTestId('edit-image-settings').click();

  await expect(panel.getByTestId('image-name-column')).toHaveValue('c0');
  await panel.getByTestId('image-base-url').fill('https://www.jacmat.cc/some-images/');
  await panel.getByTestId('image-format').selectOption('jpg');
  await panel.getByTestId('image-max-width').fill('600');
  await panel.getByTestId('image-max-height').fill('600');
  await panel.getByTestId('image-lowercase').check();
  await expect(panel.getByTestId('image-example')).toContainText('tv001-main.jpg → https://www.jacmat.cc/some-images/tv001-main.jpg');

  await expect(panel.getByTestId('save-state')).toHaveText('Saved');
  await panel.getByTestId('image-settings-toggle').click();
  await expect(panel.getByTestId('image-settings')).toContainText('named after SKU · JPG max 600×600 · → https://www.jacmat.cc/some-images/ · no ZIP');
  await panel.getByTestId('image-settings-toggle').click();
  await panel.getByTestId('tab-export').click();
  await expect(panel.getByTestId('export-image-summary')).toContainText('not downloaded · URLs point to https://www.jacmat.cc/some-images/');

  // Without the ZIP option a plain .xlsx is downloaded (with the new URLs).
  const [xlsxDl] = await Promise.all([panel.waitForEvent('download'), panel.getByTestId('export-xlsx').click()]);
  expect(xlsxDl.suggestedFilename()).toBe('sample-products-export.xlsx');

  await panel.getByTestId('tab-fields').click();
  await panel.getByTestId('image-download-zip').check();
  await panel.getByTestId('tab-export').click();
  await expect(panel.getByTestId('export-image-summary')).toContainText('downloaded and added to a ZIP');
  await expect(panel.getByTestId('export-xlsx')).toHaveText('Export .zip (workbook + images)');
  await expect(panel.getByTestId('save-state')).toHaveText('Saved');
  const [dl] = await Promise.all([panel.waitForEvent('download', { timeout: 60000 }), panel.getByTestId('export-xlsx').click()]);
  expect(dl.suggestedFilename()).toBe('sample-products-export.zip');
  await expect(panel.getByTestId('banner')).toContainText('1 image(s) could not be downloaded');
  await expect(panel.getByTestId('image-failures')).toContainText('tv001-3.jpg: HTTP 404');

  const { dir, names } = unzip(await dl.path());
  expect(names.sort()).toEqual([
    'image-report.csv',
    'images/soundbar-pro-300-main.jpg',
    'images/tv001-1.jpg',
    'images/tv001-2.jpg',
    'images/tv001-main.jpg',
    'sample-products-export.xlsx',
  ]);

  // Images are real JPGs, resized to fit 600×600 without upscaling.
  const sizes = await panel.evaluate(async (files) => {
    const out = {};
    for (const [name, b64] of Object.entries(files)) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes]));
      out[name] = [bmp.width, bmp.height, bytes[0] === 0xff && bytes[1] === 0xd8];
    }
    return out;
  }, Object.fromEntries(['tv001-main.jpg', 'tv001-1.jpg', 'tv001-2.jpg'].map((n) => [n, readFileSync(join(dir, 'images', n)).toString('base64')])));
  expect(sizes['tv001-main.jpg']).toEqual([400, 300, true]); // svg 400×300: not upscaled
  expect(sizes['tv001-2.jpg']).toEqual([600, 400, true]); // png 2400×1600 → 600×400
  expect(sizes['tv001-1.jpg'][2]).toBe(true);

  const report = readFileSync(join(dir, 'image-report.csv'), 'utf8');
  expect(report).toContain('tv001-2.jpg,https://www.jacmat.cc/some-images/tv001-2.jpg,http://localhost:4599/img/big-front.png?sw=3000,ok');
  expect(report).toMatch(/tv001-3\.jpg,.*,failed,HTTP 404/);

  // Workbook inside the zip has the new image URLs and the edited description.
  const wb = XLSX.read(readFileSync(join(dir, 'sample-products-export.xlsx')), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Products, { header: 1, defval: '' });
  const images = rows[0].indexOf('Images');
  const description = rows[0].indexOf('Description');
  expect(rows[1][images]).toBe(
    'https://www.jacmat.cc/some-images/tv001-main.jpg, https://www.jacmat.cc/some-images/tv001-1.jpg, ' +
      'https://www.jacmat.cc/some-images/tv001-2.jpg, https://www.jacmat.cc/some-images/tv001-3.jpg',
  );
  expect(rows[2][images]).toBe('https://www.jacmat.cc/some-images/soundbar-pro-300-main.jpg');
  expect(rows[1][description]).toBe(edited);
});
