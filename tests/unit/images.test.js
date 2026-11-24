import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createField, sanitizeFileName, imageExtension, publicImageUrl, planProductImages, planAllImages, computeRow, imageSettings, imageBaseName,
} from '../../src/services/fieldService.js';
import { createZip, crc32, fitSize, reportCsv } from '../../src/services/imageService.js';

const DENON = 'https://www.denon.com/dw/image/v2/bgjh_prd/on/demandware.static/-/Sites-master-catalog-soundunited/default/dw143030e2/denon/PDP_images/AVReceivers/AVR-X2800H/AVR-X2800H_front.png?sw=3000';

function project(settings = {}) {
  return {
    columns: [
      { key: 'c0', name: 'SKU', originalName: 'SKU', index: 0 },
      { key: 'c1', name: 'URL', originalName: 'URL', index: 1 },
      { key: 'c2', name: 'Name', originalName: 'Name', index: 2 },
      { key: 'n1', name: 'Images', originalName: null, index: null },
    ],
    urlColumnKey: 'c1',
    fields: [
      createField({ id: 'main', method: 'visual', kind: 'image', multiple: false, columnKey: 'n1', separator: ', ' }),
      createField({ id: 'gal', method: 'visual', kind: 'image', multiple: true, columnKey: 'n1', separator: ', ' }),
    ],
    columnFormats: {},
    imageSettings: settings,
  };
}
const img = (id, url) => ({ id, url, alt: '', title: '' });
const product = (rowIndex, sku, data, extra = {}) => ({ rowIndex, source: { 0: sku, 2: `Name ${sku}` }, data, ...extra });

describe('image file names', () => {
  it('sanitises names', () => {
    expect(sanitizeFileName('AVR X2800H / Black')).toBe('AVR-X2800H-Black');
    expect(sanitizeFileName('  Café Crème.jpg ', true)).toBe('café-crème');
    expect(sanitizeFileName('../../etc')).toBe('etc');
  });

  it('uses the SKU column by default, -main for the main image and -1, -2 for the gallery', () => {
    const p = project({ baseUrl: 'https://www.jacmat.cc/some-images' });
    expect(imageSettings(p).nameColumnKey).toBe('c0');
    const pr = product(1, 'AVR-X2800H', { main: [img('a', DENON)], gal: [img('b', 'https://x.test/b.webp'), img('c', 'https://x.test/c')] });
    const plan = planProductImages(p, pr);
    expect(plan.map((e) => e.fileName)).toEqual(['AVR-X2800H-main.jpg', 'AVR-X2800H-1.jpg', 'AVR-X2800H-2.jpg']);
    expect(plan[0].publicUrl).toBe('https://www.jacmat.cc/some-images/AVR-X2800H-main.jpg');
    expect(plan[0].sourceUrl).toBe(DENON);
    // Spreadsheet gets the new URLs
    expect(computeRow(p, pr).n1.value).toBe(
      'https://www.jacmat.cc/some-images/AVR-X2800H-main.jpg, https://www.jacmat.cc/some-images/AVR-X2800H-1.jpg, https://www.jacmat.cc/some-images/AVR-X2800H-2.jpg',
    );
  });

  it('per-product name override, other column, lowercase, formats', () => {
    const pr = product(1, 'TV001', { main: [img('a', DENON)] }, { imageName: 'My Custom Name' });
    expect(planProductImages(project({ format: 'webp' }), pr)[0].fileName).toBe('My-Custom-Name-main.webp');
    const pr2 = product(1, 'TV001', { main: [img('a', DENON)] });
    expect(planProductImages(project({ nameColumnKey: 'c2', lowercase: true }), pr2)[0].fileName).toBe('name-tv001-main.jpg');
    expect(planProductImages(project({ format: 'original' }), pr2)[0].fileName).toBe('TV001-main.png');
    expect(imageBaseName(project({ nameColumnKey: '' }), pr2)).toBe('product-2');
  });

  it('roles can be set explicitly; several main images get -main, -main-2', () => {
    const p = project();
    p.fields[1] = { ...p.fields[1], imageRole: 'main' };
    const plan = planProductImages(p, product(1, 'X', { main: [img('a', 'https://x.test/a.jpg')], gal: [img('b', 'https://x.test/b.jpg')] }));
    expect(plan.map((e) => e.fileName)).toEqual(['X-main.jpg', 'X-main-2.jpg']);
  });

  it('without a base URL the original image URLs stay in the spreadsheet', () => {
    const pr = product(1, 'X', { main: [img('a', DENON)] });
    expect(computeRow(project(), pr).n1.value).toBe(DENON);
  });

  it('makes names unique across products', () => {
    const p = project({ baseUrl: 'https://cdn.test/img/' });
    const a = product(1, 'SAME', { main: [img('a', 'https://x.test/1.jpg')] });
    const b = product(2, 'SAME', { main: [img('b', 'https://x.test/2.jpg')] });
    const c = product(3, 'SAME', { main: [img('c', 'https://x.test/1.jpg')] }); // same picture → same file
    const { plans, duplicates } = planAllImages(p, [a, b, c]);
    expect(plans.get(1)[0].fileName).toBe('SAME-main.jpg');
    expect(plans.get(2)[0].fileName).toBe('SAME-main-row3.jpg');
    expect(plans.get(2)[0].publicUrl).toBe('https://cdn.test/img/SAME-main-row3.jpg');
    expect(plans.get(3)[0].fileName).toBe('SAME-main.jpg');
    expect(duplicates).toEqual([{ fileName: 'SAME-main.jpg', rows: [1, 2] }]);
  });

  it('extension and URL helpers', () => {
    expect(imageExtension('original', 'https://x.test/a.JPEG?x=1')).toBe('jpg');
    expect(imageExtension('original', 'https://x.test/a')).toBe('jpg');
    expect(imageExtension('webp', DENON)).toBe('webp');
    expect(publicImageUrl('https://a.test/x', 'n.jpg')).toBe('https://a.test/x/n.jpg');
    expect(publicImageUrl('', 'n.jpg')).toBe('');
  });
});

describe('resizing and zip', () => {
  it('fits within the max size without upscaling', () => {
    expect(fitSize(3000, 2000, 1200, 1200)).toEqual({ width: 1200, height: 800 });
    expect(fitSize(800, 600, 1200, 1200)).toEqual({ width: 800, height: 600 });
    expect(fitSize(1000, 4000, 0, 1000)).toEqual({ width: 250, height: 1000 });
  });

  it('crc32 matches the reference value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('creates a zip that standard tools can extract', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pcc-zip-'));
    const zip = createZip([
      { name: 'a.txt', data: new TextEncoder().encode('hello') },
      { name: 'images/b-main.jpg', data: new Uint8Array([1, 2, 3, 255]) },
    ]);
    writeFileSync(join(dir, 'x.zip'), zip);
    const out = execFileSync('python3', ['-c', `
import zipfile,sys
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
print(";".join(n+"="+str(len(z.read(n))) for n in z.namelist()))`, join(dir, 'x.zip')]).toString().trim();
    expect(out).toBe('a.txt=5;images/b-main.jpg=4');
    expect(readFileSync(join(dir, 'x.zip')).length).toBe(zip.length);
  });

  it('report csv', () => {
    const csv = reportCsv([{ rowIndex: 1, fieldLabel: 'Main', role: 'main', fileName: 'a-main.jpg', publicUrl: 'u', sourceUrl: 's,1', status: 'ok', error: '', width: 10, height: 5, originalBytes: 100, bytes: 50 }]);
    expect(csv).toContain('2,Main,main,a-main.jpg,u,"s,1",ok,,10,5,100,50');
  });
});
