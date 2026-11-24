import * as XLSX from 'xlsx';
import { computeRow, planAllImages } from './fieldService.js';
import { normalizeProductUrl } from '../utils/url.js';
import { uid } from '../utils/id.js';

const READ_OPTS = { type: 'array', cellStyles: true, cellNF: true, cellDates: false };

export function readWorkbook(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return XLSX.read(bytes, READ_OPTS);
}

export function listSheets(workbook) {
  return workbook.SheetNames.map((name) => {
    const ws = workbook.Sheets[name];
    const ref = ws && ws['!ref'];
    const range = ref ? XLSX.utils.decode_range(ref) : null;
    return {
      name,
      rows: range ? range.e.r - range.s.r : 0,
      columns: range ? range.e.c - range.s.c + 1 : 0,
    };
  });
}

function cellText(cell) {
  if (!cell) return '';
  if (cell.t === 'e') return '';
  if (cell.w != null && cell.t !== 's') return String(cell.w);
  if (cell.v == null) return '';
  return String(cell.v);
}

/**
 * Reads headers and data rows of a worksheet.
 * headerRow defaults to the first row of the sheet's used range.
 */
export function readSheet(workbook, sheetName, headerRow) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) throw new Error(`Worksheet "${sheetName}" not found.`);
  if (!ws['!ref']) return { headerRow: 0, headers: [], rows: [] };
  const range = XLSX.utils.decode_range(ws['!ref']);
  const hr = headerRow ?? range.s.r;
  const seen = new Map();
  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    let name = cellText(ws[XLSX.utils.encode_cell({ r: hr, c })]).trim();
    if (!name) name = `Column ${XLSX.utils.encode_col(c)}`;
    const n = seen.get(name) || 0;
    seen.set(name, n + 1);
    if (n) name = `${name} (${n + 1})`;
    headers.push({ index: c, name });
  }
  const rows = [];
  for (let r = hr + 1; r <= range.e.r; r++) {
    const values = {};
    let any = false;
    for (const h of headers) {
      const t = cellText(ws[XLSX.utils.encode_cell({ r, c: h.index })]);
      if (t !== '') {
        values[h.index] = t;
        any = true;
      }
    }
    if (any) rows.push({ rowIndex: r, values });
  }
  return { headerRow: hr, headers, rows };
}

export function columnsFromHeaders(headers) {
  return headers.map((h) => ({ key: `c${h.index}`, name: h.name, originalName: h.name, index: h.index }));
}

export function newColumn(name) {
  return { key: uid('n_'), name, originalName: null, index: null };
}

/** Guesses the URL column: header mentioning url/link, else the column with most URL values. */
export function detectUrlColumn(headers, rows) {
  const byName = headers.find((h) => /(url|link|href)/i.test(h.name));
  if (byName) return byName.index;
  let best = null, bestCount = 0;
  for (const h of headers) {
    const count = rows.filter((r) => normalizeProductUrl(r.values[h.index])).length;
    if (count > bestCount) {
      best = h.index;
      bestCount = count;
    }
  }
  return best;
}

export function createProducts(projectId, rows, urlColumnIndex) {
  return rows.map((row, i) => {
    const raw = urlColumnIndex == null ? '' : row.values[urlColumnIndex] || '';
    return {
      projectId,
      rowIndex: row.rowIndex,
      position: i,
      url: normalizeProductUrl(raw) || '',
      rawUrl: raw,
      status: 'pending',
      source: row.values,
      data: {},
      updatedAt: Date.now(),
    };
  });
}

/**
 * Applies the project's column configuration and product data to the
 * original workbook and returns xlsx bytes. Untouched cells, other
 * worksheets and other columns are preserved as read by SheetJS.
 */
export function buildExportWorkbook(workbookBytes, project, products) {
  const wb = readWorkbook(workbookBytes);
  const ws = wb.Sheets[project.sheetName];
  if (!ws) throw new Error(`Worksheet "${project.sheetName}" no longer exists in the workbook.`);
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  const hr = project.headerRow ?? range.s.r;

  // Resolve every configured column to a sheet column index.
  const colIndex = {};
  let next = range.e.c + 1;
  for (const col of project.columns) {
    if (col.index != null) {
      colIndex[col.key] = col.index;
      if (col.originalName != null && col.name !== col.originalName) {
        ws[XLSX.utils.encode_cell({ r: hr, c: col.index })] = { t: 's', v: col.name };
      }
    }
  }
  const usedKeys = new Set();
  for (const f of project.fields) if (f.columnKey) usedKeys.add(f.columnKey);
  for (const col of project.columns) {
    if (col.index == null && usedKeys.has(col.key)) {
      colIndex[col.key] = next;
      ws[XLSX.utils.encode_cell({ r: hr, c: next })] = { t: 's', v: col.name };
      next++;
    }
  }

  let written = 0;
  let maxRow = range.e.r;
  const { plans } = planAllImages(project, products);
  for (const product of products) {
    const row = computeRow(project, product, plans.get(product.rowIndex));
    for (const [key, cell] of Object.entries(row)) {
      if (!cell.write || colIndex[key] == null) continue;
      if (cell.value === '') continue; // keep whatever the sheet already has
      const addr = XLSX.utils.encode_cell({ r: product.rowIndex, c: colIndex[key] });
      // Explicit string cell: never a formula, even if it starts with "=".
      ws[addr] = { t: 's', v: cell.value };
      written++;
      if (product.rowIndex > maxRow) maxRow = product.rowIndex;
    }
  }
  range.e.c = Math.max(range.e.c, next - 1);
  range.e.r = maxRow;
  ws['!ref'] = XLSX.utils.encode_range(range);

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true, cellStyles: true });
  return { bytes: new Uint8Array(out), cellsWritten: written, imagePlans: plans };
}

export function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
