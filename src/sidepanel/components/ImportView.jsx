import { useMemo, useState } from 'react';
import * as storage from '../../services/storageService.js';
import { readWorkbook, listSheets, readSheet, columnsFromHeaders, detectUrlColumn, createProducts } from '../../services/excelService.js';
import { suggestFields } from '../../services/fieldService.js';
import { normalizeProductUrl } from '../../utils/url.js';

/*
 * Re-importing a workbook must not lose work. These helpers carry over what
 * the user already did for the previous import.
 */

/** Columns of the new sheet, keeping names the user changed and columns the user added. */
function mergeColumns(previousColumns, headers) {
  const columns = columnsFromHeaders(headers).map((column) => {
    const previous = previousColumns.find(
      (candidate) => candidate.key === column.key && candidate.originalName === column.originalName,
    );
    return previous ? { ...column, name: previous.name } : column;
  });
  for (const previous of previousColumns) {
    if (previous.index == null) columns.push(previous); // a new column the user added
  }
  return columns;
}

/** Products of the new sheet, keeping collected data and status for rows that existed before (matched by row number). */
function mergeProducts(projectId, previousProducts, rows, urlColumnIndex) {
  const previousByRow = new Map(previousProducts.map((product) => [product.rowIndex, product]));
  return createProducts(projectId, rows, urlColumnIndex).map((product) => {
    const previous = previousByRow.get(product.rowIndex);
    return previous ? { ...product, data: previous.data, status: previous.status } : product;
  });
}

/** Fields stay as they were; a field whose column no longer exists is unmapped. */
function keepValidFields(fields, columns) {
  const columnKeys = new Set(columns.map((column) => column.key));
  return fields.map((field) => ({ ...field, columnKey: columnKeys.has(field.columnKey) ? field.columnKey : null }));
}

/** Import tab: choose a workbook, worksheet and URL column, then import. */
export default function ImportView({ ctx }) {
  const { project, products, setProject, setProducts, setView, notify, showError, saver } = ctx;
  const [file, setFile] = useState(null); // { name, bytes, workbook, sheets }
  const [sheetName, setSheetName] = useState('');
  const [urlColumn, setUrlColumn] = useState(''); // column index as text ('' = none chosen)
  const [busy, setBusy] = useState(false);

  const sheet = useMemo(() => {
    if (!file || !sheetName) return null;
    try {
      return readSheet(file.workbook, sheetName);
    } catch (error) {
      showError(error);
      return null;
    }
  }, [file, sheetName, showError]);

  async function onFileChosen(event) {
    const chosenFile = event.target.files && event.target.files[0];
    event.target.value = ''; // so choosing the same file again triggers a change
    if (!chosenFile) return;
    if (!/\.(xlsx|xlsm|xls)$/i.test(chosenFile.name)) {
      notify('error', 'Please choose an Excel workbook (.xlsx).');
      return;
    }
    try {
      const bytes = new Uint8Array(await chosenFile.arrayBuffer());
      const workbook = readWorkbook(bytes);
      const sheets = listSheets(workbook);
      if (!sheets.length) throw new Error('The workbook contains no worksheets.');
      setFile({ name: chosenFile.name, bytes, workbook, sheets });
      // Preselect the sheet with the most rows: usually the product list.
      const largestSheet = sheets.reduce((largest, candidate) => (candidate.rows > largest.rows ? candidate : largest), sheets[0]);
      chooseSheet(workbook, largestSheet.name);
      notify(null);
    } catch (error) {
      setFile(null);
      showError(new Error(`Could not read the workbook: ${error.message || error}`));
    }
  }

  function chooseSheet(workbook, name) {
    setSheetName(name);
    try {
      const chosenSheet = readSheet(workbook, name);
      const guessedColumn = detectUrlColumn(chosenSheet.headers, chosenSheet.rows);
      setUrlColumn(guessedColumn == null ? '' : String(guessedColumn));
    } catch {
      setUrlColumn('');
    }
  }

  const stats = useMemo(() => {
    if (!sheet || urlColumn === '') return null;
    const columnIndex = Number(urlColumn);
    const valid = sheet.rows.filter((row) => normalizeProductUrl(row.values[columnIndex])).length;
    return { total: sheet.rows.length, valid, invalid: sheet.rows.length - valid };
  }, [sheet, urlColumn]);

  async function doImport() {
    if (!sheet || urlColumn === '') {
      notify('error', 'Choose the worksheet and the column that contains product URLs.');
      return;
    }
    if (!sheet.rows.length) {
      notify('error', 'This worksheet has no data rows below the header row.');
      return;
    }
    setBusy(true);
    try {
      await saver.flush();
      const urlIndex = Number(urlColumn);
      const urlColumnKey = `c${urlIndex}`;
      const columns = mergeColumns(project.columns || [], sheet.headers);
      const importedProducts = mergeProducts(project.id, products, sheet.rows, urlIndex);
      let fields = keepValidFields(project.fields || [], columns);
      if (!fields.length) fields = suggestFields(columns, urlColumnKey); // first import: suggest fields

      const next = {
        ...project,
        fileName: file.name,
        sheetName,
        headerRow: sheet.headerRow,
        columns,
        urlColumnKey,
        fields,
        currentIndex: Math.min(project.currentIndex || 0, importedProducts.length - 1),
      };
      await storage.saveWorkbook(project.id, file.bytes, file.name);
      const saved = await storage.saveProject(next);
      await storage.replaceProducts(project.id, importedProducts);
      setProject(saved);
      setProducts(importedProducts);
      setFile(null);
      notify('success', `Imported ${importedProducts.length} products from "${sheetName}". Review the field configuration next.`);
      setView('fields');
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="view import-view">
      {project.fileName && (
        <section className="card">
          <h2>Current workbook</h2>
          <p>
            <strong>{project.fileName}</strong> · worksheet <strong>{project.sheetName}</strong> · {products.length} products
          </p>
          <p className="muted small">
            Importing again replaces the workbook. Data you already collected is kept for rows that still exist (matched by row number).
          </p>
        </section>
      )}

      <section className="card">
        <h2>{project.fileName ? 'Replace workbook' : 'Import Excel workbook'}</h2>
        <label className="file-drop">
          <input type="file" accept=".xlsx,.xlsm,.xls" onChange={onFileChosen} data-testid="xlsx-input" />
          <span>{file ? file.name : 'Choose an .xlsx file…'}</span>
        </label>

        {file && (
          <>
            <div className="form-grid">
              <label>
                Worksheet
                <select value={sheetName} onChange={(event) => chooseSheet(file.workbook, event.target.value)} data-testid="sheet-select">
                  {file.sheets.map((worksheet) => (
                    <option key={worksheet.name} value={worksheet.name}>
                      {worksheet.name} ({worksheet.rows} rows, {worksheet.columns} columns)
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Product URL column
                <select value={urlColumn} onChange={(event) => setUrlColumn(event.target.value)} data-testid="url-column-select">
                  <option value="">— choose —</option>
                  {sheet &&
                    sheet.headers.map((header) => (
                      <option key={header.index} value={header.index}>
                        {header.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            {sheet && (
              <>
                <h3>Columns found</h3>
                <div className="chips">
                  {sheet.headers.map((header) => (
                    <span key={header.index} className={`chip ${String(header.index) === urlColumn ? 'accent' : ''}`}>{header.name}</span>
                  ))}
                </div>
                {stats && (
                  <p className="small" data-testid="import-stats">
                    {stats.total} data rows · {stats.valid} valid URLs
                    {stats.invalid > 0 && <span className="warn"> · {stats.invalid} missing/invalid (they can be filled manually or skipped)</span>}
                  </p>
                )}
                <div className="table-wrap">
                  <table className="preview-table">
                    <thead>
                      <tr>
                        {sheet.headers.map((header) => (
                          <th key={header.index}>{header.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.rows.slice(0, 5).map((row) => (
                        <tr key={row.rowIndex}>
                          {sheet.headers.map((header) => (
                            <td key={header.index}>{row.values[header.index] || ''}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button className="btn primary" disabled={busy || urlColumn === ''} onClick={doImport} data-testid="do-import">
                  {busy ? 'Importing…' : `Import ${sheet.rows.length} products`}
                </button>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
