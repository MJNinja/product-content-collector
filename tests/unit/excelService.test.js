import { describe, it, expect } from 'vitest';
import {
  readWorkbook, listSheets, readSheet, columnsFromHeaders, detectUrlColumn, createProducts, buildExportWorkbook, newColumn, bytesToBase64, base64ToBytes,
} from '../../src/services/excelService.js';
import { createField } from '../../src/services/fieldService.js';
import { cleanCapturedHtml } from '../../src/services/htmlService.js';
import { makeWorkbook, sheetRows, rawCell } from './helpers.js';

const bytes = makeWorkbook({
  Notes: [['This sheet has notes'], ['Keep me']],
  Products: [
    ['SKU', 'Product URL', 'Category', 'Product Name', 'Stock'],
    ['TV001', 'https://example.com/product-1', 'Existing', '', 5],
    ['TV002', 'example.com/no-scheme', '', '', 3],
    ['TV003', 'www.example.com/product-3', '', '', 0],
    [],
    ['TV005', '', 'Old', 'Keep name', 1],
  ],
});

describe('import', () => {
  const wb = readWorkbook(bytes);
  it('lists worksheets', () => {
    expect(listSheets(wb).map((s) => s.name)).toEqual(['Notes', 'Products']);
  });
  it('reads headers and rows of the chosen worksheet, skipping empty rows', () => {
    const s = readSheet(wb, 'Products');
    expect(s.headers.map((h) => h.name)).toEqual(['SKU', 'Product URL', 'Category', 'Product Name', 'Stock']);
    expect(s.rows.map((r) => r.rowIndex)).toEqual([1, 2, 3, 5]);
    expect(s.rows[0].values[4]).toBe('5');
  });
  it('a different worksheet gives different columns', () => {
    expect(readSheet(wb, 'Notes').headers.map((h) => h.name)).toEqual(['This sheet has notes']);
  });
  it('detects the URL column and validates URLs', () => {
    const s = readSheet(wb, 'Products');
    expect(detectUrlColumn(s.headers, s.rows)).toBe(1);
    const products = createProducts('p', s.rows, 1);
    expect(products.map((p) => p.url)).toEqual(['https://example.com/product-1', '', 'https://www.example.com/product-3', '']);
    expect(products[1].rawUrl).toBe('example.com/no-scheme');
    expect(products.every((p) => p.status === 'pending')).toBe(true);
  });
  it('detects a URL column by content when the header does not say so', () => {
    const wb2 = readWorkbook(makeWorkbook({ S: [['Code', 'Where'], ['A', 'https://a.test/1'], ['B', 'https://a.test/2']] }));
    const s = readSheet(wb2, 'S');
    expect(detectUrlColumn(s.headers, s.rows)).toBe(1);
  });
  it('names blank and duplicate headers', () => {
    const wb3 = readWorkbook(makeWorkbook({ S: [['A', '', 'A'], ['1', '2', '3']] }));
    expect(readSheet(wb3, 'S').headers.map((h) => h.name)).toEqual(['A', 'Column B', 'A (2)']);
  });
});

describe('export', () => {
  const wb = readWorkbook(bytes);
  const s = readSheet(wb, 'Products');
  const columns = columnsFromHeaders(s.headers);
  const descCol = newColumn('Description');
  const imgCol = newColumn('Images');
  columns.push(descCol, imgCol);
  columns.find((c) => c.key === 'c3').name = 'Name'; // renamed column

  const fields = [
    createField({ id: 'sku', method: 'source', columnKey: 'c0' }),
    createField({ id: 'title', method: 'visual', kind: 'text', columnKey: 'c3' }),
    createField({ id: 'main', kind: 'list', columnKey: 'c2' }),
    createField({ id: 'sub', kind: 'list', columnKey: 'c2' }),
    createField({ id: 'desc', method: 'visual', kind: 'html', multiple: true, columnKey: descCol.key, separator: '\n' }),
    createField({ id: 'img', method: 'visual', kind: 'image', columnKey: imgCol.key, separator: ', ' }),
  ];
  const project = {
    sheetName: 'Products', headerRow: 0, columns, urlColumnKey: 'c1', fields,
    columnFormats: { c2: { mode: 'prefix', separator: ', ', pathSeparator: ' > ' } },
  };
  const products = createProducts('p', s.rows, 1);
  products[0].data = {
    title: [{ id: 't', html: '<h1>TV One</h1>', text: 'TV One' }],
    main: 'Electronics, Television',
    sub: 'Smart TVs, 4K TVs',
    desc: [
      { id: '1', ...cleanCapturedHtml('<h2>Features</h2>', 'h2'), outputTag: 'h3' },
      { id: '2', ...cleanCapturedHtml('<p>=SUM(A1:A2) is not a formula</p>', 'p') },
    ],
    img: [{ id: 'i', url: 'https://example.com/a.jpg', alt: 'Front view', title: '' }],
  };
  products[1].data = { main: 'Audio', sub: '' };
  products[3].data = { title: [{ id: 'x', html: '', text: '' }] }; // empty → existing kept

  const { bytes: out, cellsWritten } = buildExportWorkbook(bytes, project, products);
  const rows = sheetRows(out, 'Products');

  it('preserves other worksheets', () => {
    expect(sheetRows(out, 'Notes')).toEqual([['This sheet has notes'], ['Keep me']]);
  });
  it('renames headers and adds new columns at the end', () => {
    expect(rows[0]).toEqual(['SKU', 'Product URL', 'Category', 'Name', 'Stock', 'Description', 'Images']);
  });
  it('writes combined values per product, keeping SKUs and other data', () => {
    expect(rows[1].slice(0, 5)).toEqual(['TV001', 'https://example.com/product-1', 'Electronics > Television > Smart TVs, Electronics > Television > 4K TVs', 'TV One', 5]);
    expect(rows[1][5]).toBe('<h3>Features</h3>\n<p>=SUM(A1:A2) is not a formula</p>');
    expect(rows[1][6]).toBe('https://example.com/a.jpg');
    expect(rows[1]).toHaveLength(7);
    expect(rows[2][2]).toBe('Audio');
    expect(rows[2][0]).toBe('TV002');
  });
  it('keeps existing cells when there is nothing to write, and keeps empty rows', () => {
    expect(rows[4]).toEqual(['', '', '', '', '', '', '']);
    expect(rows[5].slice(0, 5)).toEqual(['TV005', '', 'Old', 'Keep name', 1]);
  });
  it('stores HTML as literal strings, never formulas', () => {
    const c = rawCell(out, 'Products', 'F2');
    expect(c.t).toBe('s');
    expect(c.f).toBeUndefined();
    const wbFormula = readWorkbook(bytes);
    expect(wbFormula).toBeTruthy();
  });
  it('a value starting with "=" stays text', () => {
    const p2 = { ...project, fields: [createField({ id: 'm', columnKey: 'c3' })] };
    const pr = createProducts('p', s.rows, 1).slice(0, 1);
    pr[0].data = { m: '=1+1' };
    const res = buildExportWorkbook(bytes, p2, pr).bytes;
    const c = rawCell(res, 'Products', 'D2');
    expect(c).toMatchObject({ t: 's', v: '=1+1' });
    expect(c.f).toBeUndefined();
  });
  it('the exported workbook can be re-imported', () => {
    const again = readSheet(readWorkbook(out), 'Products');
    expect(again.rows.length).toBe(4);
    expect(cellsWritten).toBe(5);
  });
  it('base64 round trip', () => {
    expect(Array.from(base64ToBytes(bytesToBase64(out)))).toEqual(Array.from(out));
  });
  it('fails clearly when the worksheet is missing', () => {
    expect(() => buildExportWorkbook(bytes, { ...project, sheetName: 'Nope' }, [])).toThrow(/Nope/);
  });
});
