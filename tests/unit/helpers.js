import * as XLSX from 'xlsx';

/** Builds an xlsx (bytes) from { sheetName: [[header...], [row...]] } */
export function makeWorkbook(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

export function sheetRows(bytes, name) {
  const wb = XLSX.read(bytes, { type: 'array' });
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
}

export function rawCell(bytes, name, addr) {
  const wb = XLSX.read(bytes, { type: 'array', cellFormula: true });
  return wb.Sheets[name][addr];
}
