import { useMemo, useState } from 'react';
import * as storage from '../../services/storageService.js';
import { readWorkbook, listSheets, readSheet, columnsFromHeaders, detectUrlColumn, createProducts } from '../../services/excelService.js';
import { suggestFields } from '../../services/fieldService.js';
import { normalizeProductUrl } from '../../utils/url.js';

export default function ImportView({ ctx }) {
  const { project, products, setProject, setProducts, setView, notify, showError, saver } = ctx;
  const [file, setFile] = useState(null); // { name, bytes, workbook, sheets }
  const [sheetName, setSheetName] = useState('');
  const [urlCol, setUrlCol] = useState('');
  const [busy, setBusy] = useState(false);

  const sheet = useMemo(() => {
    if (!file || !sheetName) return null;
    try {
      return readSheet(file.workbook, sheetName);
    } catch (err) {
      showError(err);
      return null;
    }
  }, [file, sheetName, showError]);

  async function onFile(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!/\.(xlsx|xlsm|xls)$/i.test(f.name)) {
      notify('error', 'Please choose an Excel workbook (.xlsx).');
      return;
    }
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const workbook = readWorkbook(bytes);
      const sheets = listSheets(workbook);
      if (!sheets.length) throw new Error('The workbook contains no worksheets.');
      setFile({ name: f.name, bytes, workbook, sheets });
      const first = sheets.reduce((best, s) => (s.rows > best.rows ? s : best), sheets[0]);
      chooseSheet(workbook, first.name);
      notify(null);
    } catch (err) {
      setFile(null);
      showError(new Error(`Could not read the workbook: ${err.message || err}`));
    }
  }

  function chooseSheet(workbook, name) {
    setSheetName(name);
    try {
      const s = readSheet(workbook, name);
      const guess = detectUrlColumn(s.headers, s.rows);
      setUrlCol(guess == null ? '' : String(guess));
    } catch {
      setUrlCol('');
    }
  }

  const stats = useMemo(() => {
    if (!sheet || urlCol === '') return null;
    const idx = Number(urlCol);
    const valid = sheet.rows.filter((r) => normalizeProductUrl(r.values[idx])).length;
    return { total: sheet.rows.length, valid, invalid: sheet.rows.length - valid };
  }, [sheet, urlCol]);

  async function doImport() {
    if (!sheet || urlCol === '') {
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
      const urlIndex = Number(urlCol);
      // Keep renamed original columns and added columns from an earlier import.
      const oldCols = project.columns || [];
      const columns = columnsFromHeaders(sheet.headers).map((c) => {
        const old = oldCols.find((o) => o.key === c.key && o.originalName === c.originalName);
        return old ? { ...c, name: old.name } : c;
      });
      for (const o of oldCols) if (o.index == null) columns.push(o);
      const urlColumnKey = `c${urlIndex}`;

      // Keep collected data for rows that already exist.
      const byRow = new Map(products.map((p) => [p.rowIndex, p]));
      const fresh = createProducts(project.id, sheet.rows, urlIndex).map((p) => {
        const old = byRow.get(p.rowIndex);
        return old ? { ...p, data: old.data, status: old.status } : p;
      });

      const validKeys = new Set(columns.map((c) => c.key));
      let fields = (project.fields || []).map((f) => ({
        ...f,
        columnKey: validKeys.has(f.columnKey) ? f.columnKey : null,
      }));
      if (!fields.length) fields = suggestFields(columns, urlColumnKey);

      const next = {
        ...project,
        fileName: file.name,
        sheetName,
        headerRow: sheet.headerRow,
        columns,
        urlColumnKey,
        fields,
        currentIndex: Math.min(project.currentIndex || 0, fresh.length - 1),
      };
      await storage.saveWorkbook(project.id, file.bytes, file.name);
      const saved = await storage.saveProject(next);
      await storage.replaceProducts(project.id, fresh);
      setProject(saved);
      setProducts(fresh);
      setFile(null);
      notify('success', `Imported ${fresh.length} products from "${sheetName}". Review the field configuration next.`);
      setView('fields');
    } catch (err) {
      showError(err);
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
          <input type="file" accept=".xlsx,.xlsm,.xls" onChange={onFile} data-testid="xlsx-input" />
          <span>{file ? file.name : 'Choose an .xlsx file…'}</span>
        </label>

        {file && (
          <>
            <div className="form-grid">
              <label>
                Worksheet
                <select value={sheetName} onChange={(e) => chooseSheet(file.workbook, e.target.value)} data-testid="sheet-select">
                  {file.sheets.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} ({s.rows} rows, {s.columns} columns)
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Product URL column
                <select value={urlCol} onChange={(e) => setUrlCol(e.target.value)} data-testid="url-column-select">
                  <option value="">— choose —</option>
                  {sheet &&
                    sheet.headers.map((h) => (
                      <option key={h.index} value={h.index}>
                        {h.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            {sheet && (
              <>
                <h3>Columns found</h3>
                <div className="chips">
                  {sheet.headers.map((h) => (
                    <span key={h.index} className={`chip ${String(h.index) === urlCol ? 'accent' : ''}`}>{h.name}</span>
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
                        {sheet.headers.map((h) => (
                          <th key={h.index}>{h.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.rows.slice(0, 5).map((r) => (
                        <tr key={r.rowIndex}>
                          {sheet.headers.map((h) => (
                            <td key={h.index}>{r.values[h.index] || ''}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button className="btn primary" disabled={busy || urlCol === ''} onClick={doImport} data-testid="do-import">
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
