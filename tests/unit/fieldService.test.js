import { describe, it, expect } from 'vitest';
import { parseList, computeRow, fieldValues, missingRequired, createField, suggestFields, decodeSeparator, createPresetField, PRESET_LABELS } from '../../src/services/fieldService.js';
import { cleanCapturedHtml } from '../../src/services/htmlService.js';

function project(fields, columnFormats = {}) {
  return {
    columns: [
      { key: 'c0', name: 'SKU', originalName: 'SKU', index: 0 },
      { key: 'c1', name: 'URL', originalName: 'URL', index: 1 },
      { key: 'c2', name: 'Categories', originalName: 'Categories', index: 2 },
      { key: 'n1', name: 'Images', originalName: null, index: null },
      { key: 'n2', name: 'Image Alt', originalName: null, index: null },
      { key: 'n3', name: 'Description', originalName: null, index: null },
    ],
    urlColumnKey: 'c1',
    fields,
    columnFormats,
  };
}
const product = (data, source = { 0: 'TV001', 1: 'https://x.test/1', 2: 'Old cat' }) => ({ rowIndex: 1, source, data });

describe('comma-separated category parsing', () => {
  it('trims, removes empty entries and duplicates', () => {
    expect(parseList('  Electronics,Television , , Entertainment,,Television ')).toEqual(['Electronics', 'Television', 'Entertainment']);
    expect(parseList('')).toEqual([]);
    expect(parseList(null)).toEqual([]);
    expect(parseList('Smart   TVs,4K TVs')).toEqual(['Smart TVs', '4K TVs']);
  });
});

describe('category + subcategory formatting in one column', () => {
  const main = createField({ id: 'main', label: 'Main categories', kind: 'list', columnKey: 'c2' });
  const sub = createField({ id: 'sub', label: 'Subcategories', kind: 'list', columnKey: 'c2' });
  const data = { main: 'Electronics, Television', sub: 'Smart TVs, 4K TVs' };

  it('join (default comma)', () => {
    const r = computeRow(project([main, sub]), product(data));
    expect(r.c2.value).toBe('Electronics, Television, Smart TVs, 4K TVs');
    expect(r.c2.parts.map((p) => p.label)).toEqual(['Main categories', 'Subcategories']);
  });
  it('custom separator', () => {
    const r = computeRow(project([main, sub], { c2: { mode: 'join', separator: ' | ' } }), product(data));
    expect(r.c2.value).toBe('Electronics, Television | Smart TVs, 4K TVs');
    const m2 = { ...main, separator: '|' };
    const s2 = { ...sub, separator: '|' };
    expect(computeRow(project([m2, s2], { c2: { mode: 'join', separator: '|' } }), product(data)).c2.value).toBe('Electronics|Television|Smart TVs|4K TVs');
  });
  it('single hierarchical path', () => {
    const r = computeRow(project([main, sub], { c2: { mode: 'path', pathSeparator: ' > ' } }), product({ main: 'Electronics, Television', sub: 'Smart TVs' }));
    expect(r.c2.value).toBe('Electronics > Television > Smart TVs');
  });
  it('path per value of last field (WooCommerce style)', () => {
    const r = computeRow(project([main, sub], { c2: { mode: 'prefix', separator: ', ', pathSeparator: ' > ' } }), product(data));
    expect(r.c2.value).toBe('Electronics > Television > Smart TVs, Electronics > Television > 4K TVs');
  });
  it('one field empty does not leave dangling separators', () => {
    expect(computeRow(project([main, sub]), product({ main: '', sub: 'Audio' })).c2.value).toBe('Audio');
    expect(computeRow(project([main, sub], { c2: { mode: 'path' } }), product({ main: 'Electronics' })).c2.value).toBe('Electronics');
  });
  it('both empty → no value (existing cell kept)', () => {
    const r = computeRow(project([main, sub]), product({}));
    expect(r.c2.value).toBe('');
  });
});

describe('field kinds', () => {
  it('source field mirrors the sheet and only writes when overridden', () => {
    const sku = createField({ id: 'sku', method: 'source', columnKey: 'c0' });
    let r = computeRow(project([sku]), product({}));
    expect(r.c0).toMatchObject({ value: 'TV001', write: false });
    r = computeRow(project([sku]), product({ sku: 'TV001-B' }));
    expect(r.c0).toMatchObject({ value: 'TV001-B', write: true });
  });

  it('image fields output only their URLs (no alt/title columns)', () => {
    const main = createField({ id: 'img', method: 'visual', kind: 'image', multiple: false, columnKey: 'n1', separator: ', ' });
    const gallery = createField({ id: 'gal', method: 'visual', kind: 'image', multiple: true, columnKey: 'n1', separator: ', ' });
    const p = product({
      img: [{ id: 'a', url: 'https://x.test/main.jpg', alt: 'Main', title: '' }],
      gal: [{ id: 'b', url: 'https://x.test/g1.jpg', alt: '', title: '' }, { id: 'c', url: 'https://x.test/g2.jpg', alt: '', title: '' }],
    });
    const r = computeRow(project([main, gallery]), p);
    expect(r.n1.value).toBe('https://x.test/main.jpg, https://x.test/g1.jpg, https://x.test/g2.jpg');
    expect(r.n2).toBeUndefined();
    expect(main).not.toHaveProperty('altColumnKey');
  });

  it('visual html fields render selections with their output tags', () => {
    const desc = createField({ id: 'd', method: 'visual', kind: 'html', multiple: true, columnKey: 'n3', separator: '\n' });
    const items = [
      { id: '1', ...cleanCapturedHtml('<h2>Features</h2>', 'h2'), outputTag: 'h3' },
      { id: '2', ...cleanCapturedHtml('<p onclick="x()">Intro</p>', 'p') },
    ];
    expect(computeRow(project([desc]), product({ d: items })).n3.value).toBe('<h3>Features</h3>\n<p>Intro</p>');
  });

  it('visual text uses the (editable) text of selections', () => {
    const title = createField({ id: 't', method: 'visual', kind: 'text', multiple: false, columnKey: 'n3' });
    expect(fieldValues(project([title]), title, product({ t: [{ id: '1', html: '<h1>X</h1>', text: 'Edited title' }] })).values).toEqual(['Edited title']);
  });

  it('manual html is sanitised', () => {
    const f = createField({ id: 'h', method: 'manual', kind: 'html', columnKey: 'n3' });
    expect(computeRow(project([f]), product({ h: '<p onclick="x">A</p><script>bad()</script>' })).n3.value).toBe('<p>A</p>');
  });

  it('required fields are reported when empty', () => {
    const f = createField({ id: 'r', label: 'Title', required: true, columnKey: 'n3' });
    expect(missingRequired(project([f]), product({}))).toEqual(['Title']);
    expect(missingRequired(project([f]), product({ r: 'x' }))).toEqual([]);
  });

  it('separators accept escape sequences', () => {
    expect(decodeSeparator('\\n')).toBe('\n');
  });
});

describe('per-product isolation', () => {
  it('different products keep independent values', () => {
    const main = createField({ id: 'main', kind: 'list', columnKey: 'c2' });
    const proj = project([main]);
    const p1 = product({ main: 'Electronics, Entertainment' });
    const p2 = product({ main: 'Electronics' });
    const p3 = { ...p2, data: { ...p2.data, main: 'Appliances' } }; // immutable update of a copy
    expect(computeRow(proj, p1).c2.value).toBe('Electronics, Entertainment');
    expect(computeRow(proj, p2).c2.value).toBe('Electronics');
    expect(computeRow(proj, p3).c2.value).toBe('Appliances');
  });
});

describe('suggested fields', () => {
  it('maps to headers that exist, never invents column names', () => {
    const cols = [
      { key: 'c0', name: 'SKU', index: 0 },
      { key: 'c1', name: 'Product URL', index: 1 },
      { key: 'c2', name: 'Category', index: 2 },
    ];
    const f = suggestFields(cols, 'c1');
    expect(f.find((x) => x.label === 'SKU').columnKey).toBe('c0');
    expect(f.find((x) => x.label === 'Main categories').columnKey).toBe('c2');
    expect(f.find((x) => x.label === 'Product description').columnKey).toBe(null);
    expect(f.every((x) => x.columnKey !== 'c1')).toBe(true);
  });
});

describe('Product intro field', () => {
  const cols = [
    { key: 'c0', name: 'SKU', index: 0 },
    { key: 'c1', name: 'URL', index: 1 },
    { key: 'c2', name: 'Intro', index: 2 },
    { key: 'c3', name: 'Description', index: 3 },
  ];
  it('is suggested like the description and mapped to an "Intro" column', () => {
    const f = suggestFields(cols, 'c1');
    const intro = f.find((x) => x.label === 'Product intro');
    const desc = f.find((x) => x.label === 'Product description');
    expect(f.map((x) => x.label).indexOf('Product intro')).toBe(f.map((x) => x.label).indexOf('Product description') - 1);
    expect(intro).toMatchObject({ method: 'visual', kind: 'html', multiple: true, separator: '\n', columnKey: 'c2' });
    expect({ ...intro, id: 0, label: 0, columnKey: 0 }).toEqual({ ...desc, id: 0, label: 0, columnKey: 0 });
  });
  it('can be added to an existing project from the ready-made list', () => {
    expect(PRESET_LABELS).toContain('Product intro');
    const f = createPresetField('Product intro', cols, 'c1');
    expect(f).toMatchObject({ label: 'Product intro', kind: 'html', columnKey: 'c2' });
    expect(createPresetField('Product intro', cols.filter((c) => c.key !== 'c2'), 'c1').columnKey).toBe(null);
  });
});
