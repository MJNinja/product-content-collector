// Creates sample workbooks for automated and manual testing.
import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';

const base = process.env.FIXTURE_BASE || 'http://localhost:4599';
mkdirSync('tests/fixtures', { recursive: true });
mkdirSync('samples', { recursive: true });

function save(file, sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// WooCommerce-like template: notes sheet first, products on the second sheet.
const woo = {
  'Read me': [['Products are on the "Products" sheet.'], ['Do not delete this sheet.']],
  Products: [
    ['SKU', 'Product URL', 'Categories', 'Name', 'Description', 'Images', 'Stock', 'Supplier'],
    ['TV001', `${base}/product-1.html`, '', '', '', '', 12, 'ACME'],
    ['TV002', `${base}/product-2.html`, 'Existing category', '', '', '', 4, 'ACME'],
    ['TV003', `${base}/product-3.html`, '', '', '', '', 0, 'Cold Inc.'],
    ['TV004', 'not a url', '', '', '', '', 1, 'Nobody'],
  ],
};
save('tests/fixtures/sample-products.xlsx', woo);
save('samples/sample-products.xlsx', woo);

// A different client structure: other headers, URL column not named "url".
const other = {
  Catalogue: [
    ['Article no.', 'Title', 'Source page', 'Main category', 'Sub category', 'Body HTML', 'Picture'],
    ['A-1', '', `${base}/product-2.html`, '', '', '', ''],
    ['A-2', '', `${base}/product-1.html`, '', '', '', ''],
  ],
};
save('tests/fixtures/sample-other-structure.xlsx', other);
save('samples/sample-other-structure.xlsx', other);
console.log('sample workbooks written');
