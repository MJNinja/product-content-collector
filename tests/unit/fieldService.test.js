import { describe, it, expect } from 'vitest';
import { parseList, computeRow, fieldValues, missingRequired, createField, suggestFields, decodeSeparator, createPresetField, PRESET_LABELS, labelColumn, productLabel, copyableFields, copyProductData, hasCopyableData } from '../../src/services/fieldService.js';
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

describe('product identifier (Collect tab list)', () => {
  const cols = [
    { key: 'c0', name: 'Category', index: 0 },
    { key: 'c1', name: 'URL', index: 1 },
    { key: 'c2', name: 'Name', index: 2 },
    { key: 'c3', name: 'SKU', index: 3 },
    { key: 'n1', name: 'New', index: null },
  ];
  const proj = (labelColumnKey) => ({ columns: cols, urlColumnKey: 'c1', labelColumnKey });
  const prod = { rowIndex: 4, url: 'https://x.test/p', source: { 0: 'PA Equipment', 1: 'https://x.test/p', 2: 'Mixer 8', 3: 'A8-2U' } };

  it('automatic: SKU-like column, then name/title, then first non-URL column', () => {
    expect(labelColumn(proj(undefined)).key).toBe('c3');
    expect(productLabel(proj(null), prod)).toBe('A8-2U');
    expect(labelColumn({ ...proj(), columns: cols.filter((c) => c.key !== 'c3') }).key).toBe('c2');
    expect(labelColumn({ ...proj(), columns: cols.filter((c) => !['c2', 'c3'].includes(c.key)) }).key).toBe('c0');
  });
  it('uses the chosen column for every product', () => {
    expect(productLabel(proj('c2'), prod)).toBe('Mixer 8');
    expect(productLabel(proj('c0'), prod)).toBe('PA Equipment');
  });
  it('falls back to the URL, then the row, when the value is empty or none is chosen', () => {
    expect(productLabel(proj(''), prod)).toBe('https://x.test/p');
    expect(productLabel(proj('c2'), { rowIndex: 4, url: 'https://x.test/q', source: {} })).toBe('https://x.test/q');
    expect(productLabel(proj('c2'), { rowIndex: 4, url: '', source: {} })).toBe('Row 5');
  });
  it('a column that no longer exists falls back to automatic', () => {
    expect(labelColumn(proj('c9')).key).toBe('c3');
  });
});

describe('copying data from a completed product', () => {
  const fields = [
    createField({ id: 'sku', method: 'source', kind: 'text', columnKey: 'c0' }),
    createField({ id: 'title', method: 'visual', kind: 'text', columnKey: 'c1' }),
    createField({ id: 'cats', method: 'manual', kind: 'list', columnKey: 'c2' }),
    createField({ id: 'desc', method: 'visual', kind: 'html', columnKey: 'c3' }),
    createField({ id: 'img', method: 'visual', kind: 'image', columnKey: 'c4' }),
  ];
  const proj = { columns: [{ key: 'c0', name: 'SKU', index: 0 }], urlColumnKey: null, fields };
  const from = {
    rowIndex: 1,
    status: 'completed',
    imageName: 'Red-TV',
    source: { 0: 'TV-RED' },
    data: {
      title: [{ id: 's1', html: '<h1>TV</h1>', text: 'TV' }],
      cats: 'Electronics, TVs',
      desc: [{ id: 's2', html: '<p>Great</p>', text: 'Great', sourceTag: 'p', outputTag: 'keep' }],
      img: [{ id: 'i1', url: 'https://x.test/red.jpg' }],
    },
  };
  const to = { rowIndex: 2, status: 'pending', source: { 0: 'TV-BLUE' }, data: { sku: 'TV-BLUE-OVERRIDE', img: [{ id: 'i9', url: 'https://x.test/blue.jpg' }] } };

  it('copies manual and visual fields, never spreadsheet fields', () => {
    expect(copyableFields(proj).map((field) => field.id)).toEqual(['title', 'cats', 'desc']);
    expect(copyableFields(proj, { includeImages: true }).map((field) => field.id)).toEqual(['title', 'cats', 'desc', 'img']);
    const data = copyProductData(proj, from, to);
    expect(data.sku).toBe('TV-BLUE-OVERRIDE'); // source override stays
    expect(data.cats).toBe('Electronics, TVs');
    expect(data.title[0]).toMatchObject({ html: '<h1>TV</h1>', text: 'TV' });
    expect(data.desc[0]).toMatchObject({ html: '<p>Great</p>', outputTag: 'keep' });
    expect(data.img).toEqual([{ id: 'i9', url: 'https://x.test/blue.jpg' }]); // images left alone
  });

  it('copies images only when asked, with new ids', () => {
    const data = copyProductData(proj, from, to, { includeImages: true });
    expect(data.img).toHaveLength(1);
    expect(data.img[0].url).toBe('https://x.test/red.jpg');
    expect(data.img[0].id).not.toBe('i1');
    expect(data.title[0].id).not.toBe('s1');
  });

  it('replaces: a field empty in the source product becomes empty', () => {
    const data = copyProductData(proj, { data: { title: from.data.title } }, { data: { cats: 'Old' } });
    expect(data).not.toHaveProperty('cats');
    expect(data.title).toHaveLength(1);
  });

  it('knows whether the current product has data that would be replaced', () => {
    expect(hasCopyableData(proj, to)).toBe(false); // only a source override and an image
    expect(hasCopyableData(proj, to, { includeImages: true })).toBe(true);
    expect(hasCopyableData(proj, from)).toBe(true);
  });
});
