import * as XLSX from 'xlsx';
import { computeRow, planAllImages } from './fieldService.js';
import { normalizeProductUrl } from '../utils/url.js';
import { uid } from '../utils/id.js';

/*
 * Excel reading and writing with SheetJS.
 *
 * SheetJS terms used below:
 *   sheet['!ref']   the used range, e.g. "A1:H250"
 *   decode_range()  turns it into { s: start, e: end }, each { r: row, c: column } (0-based)
 *   encode_cell()   turns { r, c } into an address like "C5"
 *   cell.t          type: 's' string, 'n' number, 'b' boolean, 'e' error …
 *   cell.v / cell.w raw value / value as formatted in Excel
 */

const READ_OPTIONS = { type: 'array', cellStyles: true, cellNF: true, cellDates: false };

export function readWorkbook(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return XLSX.read(bytes, READ_OPTIONS);
}

/** Name, data row count and column count of every worksheet. */
export function listSheets(workbook) {
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const usedRange = sheet && sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
    if (!usedRange) return { name, rows: 0, columns: 0 };
    return {
      name,
      rows: usedRange.e.r - usedRange.s.r, // excluding the header row
      columns: usedRange.e.c - usedRange.s.c + 1,
    };
  });
}

/** A cell's value as text, as the user sees it in Excel (errors become empty). */
function cellText(cell) {
  if (!cell) return '';
  if (cell.t === 'e') return '';
  if (cell.w != null && cell.t !== 's') return String(cell.w); // formatted numbers/dates
  if (cell.v == null) return '';
  return String(cell.v);
}

/**
 * Reads headers and data rows of a worksheet.
 * headerRow defaults to the first row of the sheet's used range.
 * Empty header cells are named "Column X"; repeated names get " (2)", " (3)" ….
 */
export function readSheet(workbook, sheetName, headerRow) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Worksheet "${sheetName}" not found.`);
  if (!sheet['!ref']) return { headerRow: 0, headers: [], rows: [] };

  const usedRange = XLSX.utils.decode_range(sheet['!ref']);
  const headerRowIndex = headerRow ?? usedRange.s.r;
  const cellAt = (rowIndex, columnIndex) => sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];

  const headers = [];
  const timesSeen = new Map(); // header name → how often it occurred so far
  for (let columnIndex = usedRange.s.c; columnIndex <= usedRange.e.c; columnIndex++) {
    let name = cellText(cellAt(headerRowIndex, columnIndex)).trim();
    if (!name) name = `Column ${XLSX.utils.encode_col(columnIndex)}`;
    const count = timesSeen.get(name) || 0;
    timesSeen.set(name, count + 1);
    if (count > 0) name = `${name} (${count + 1})`;
    headers.push({ index: columnIndex, name });
  }

  const rows = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex <= usedRange.e.r; rowIndex++) {
    const values = {}; // column index → text; empty cells are left out
    for (const header of headers) {
      const text = cellText(cellAt(rowIndex, header.index));
      if (text !== '') values[header.index] = text;
    }
    const rowHasValues = Object.keys(values).length > 0;
    if (rowHasValues) rows.push({ rowIndex, values });
  }
  return { headerRow: headerRowIndex, headers, rows };
}

/** Project columns for the sheet's existing columns. Key "c3" = sheet column index 3. */
export function columnsFromHeaders(headers) {
  return headers.map((header) => ({ key: `c${header.index}`, name: header.name, originalName: header.name, index: header.index }));
}

/** A column that does not exist in the sheet yet; it is added at the end on export. */
export function newColumn(name) {
  return { key: uid('n_'), name, originalName: null, index: null };
}

/** Guesses the URL column: header mentioning url/link, else the column with most URL values. */
export function detectUrlColumn(headers, rows) {
  const headerWithUrlName = headers.find((header) => /(url|link|href)/i.test(header.name));
  if (headerWithUrlName) return headerWithUrlName.index;

  let bestColumnIndex = null;
  let bestUrlCount = 0;
  for (const header of headers) {
    const urlCount = rows.filter((row) => normalizeProductUrl(row.values[header.index])).length;
    if (urlCount > bestUrlCount) {
      bestColumnIndex = header.index;
      bestUrlCount = urlCount;
    }
  }
  return bestColumnIndex;
}

/** One product record per sheet row. */
export function createProducts(projectId, rows, urlColumnIndex) {
  return rows.map((row, position) => {
    const rawUrl = urlColumnIndex == null ? '' : row.values[urlColumnIndex] || '';
    return {
      projectId,
      rowIndex: row.rowIndex,
      position,
      url: normalizeProductUrl(rawUrl) || '',
      rawUrl,
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
  const workbook = readWorkbook(workbookBytes);
  const sheet = workbook.Sheets[project.sheetName];
  if (!sheet) throw new Error(`Worksheet "${project.sheetName}" no longer exists in the workbook.`);
  const usedRange = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const headerRowIndex = project.headerRow ?? usedRange.s.r;
  const setCell = (rowIndex, columnIndex, text) => {
    // Explicit string cell: never a formula, even if it starts with "=".
    sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })] = { t: 's', v: text };
  };

  // Work out which sheet column each project column writes to.
  const sheetColumnByKey = {};

  // Existing columns keep their place; renamed ones get the new header.
  for (const column of project.columns) {
    if (column.index == null) continue;
    sheetColumnByKey[column.key] = column.index;
    const isRenamed = column.originalName != null && column.name !== column.originalName;
    if (isRenamed) setCell(headerRowIndex, column.index, column.name);
  }

  // New columns that a field writes to are added after the last used column.
  const usedColumnKeys = new Set(project.fields.map((field) => field.columnKey).filter(Boolean));
  let nextFreeColumn = usedRange.e.c + 1;
  for (const column of project.columns) {
    if (column.index != null || !usedColumnKeys.has(column.key)) continue;
    sheetColumnByKey[column.key] = nextFreeColumn;
    setCell(headerRowIndex, nextFreeColumn, column.name);
    nextFreeColumn++;
  }

  // Write each product's values.
  let cellsWritten = 0;
  let lastRow = usedRange.e.r;
  const { plans: imagePlans } = planAllImages(project, products);
  for (const product of products) {
    const row = computeRow(project, product, imagePlans.get(product.rowIndex));
    for (const [columnKey, cell] of Object.entries(row)) {
      const sheetColumn = sheetColumnByKey[columnKey];
      if (!cell.write || sheetColumn == null) continue;
      if (cell.value === '') continue; // keep whatever the sheet already has
      setCell(product.rowIndex, sheetColumn, cell.value);
      cellsWritten++;
      lastRow = Math.max(lastRow, product.rowIndex);
    }
  }

  // Grow the used range so Excel sees the new columns and rows.
  usedRange.e.c = Math.max(usedRange.e.c, nextFreeColumn - 1);
  usedRange.e.r = lastRow;
  sheet['!ref'] = XLSX.utils.encode_range(usedRange);

  const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true, cellStyles: true });
  return { bytes: new Uint8Array(output), cellsWritten, imagePlans };
}

/** Bytes → base64 text (used to store the workbook in backups). */
export function bytesToBase64(bytes) {
  // String.fromCharCode can only take a limited number of arguments, so convert in chunks.
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let start = 0; start < bytes.length; start += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(start, start + CHUNK_SIZE));
  }
  return btoa(binary);
}

/** Base64 text → bytes. */
export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
