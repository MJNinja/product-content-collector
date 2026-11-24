import { useMemo, useState } from 'react';
import * as storage from '../../services/storageService.js';
import { buildExportWorkbook, XLSX_MIME } from '../../services/excelService.js';
import { missingRequired, imageSettings } from '../../services/fieldService.js';
import { collectImages, createZip, reportCsv } from '../../services/imageService.js';
import { countStatuses, downloadBytes, safeFileName, ProgressBar } from './common.jsx';

export default function ExportView({ ctx }) {
  const { project, products, saver, notify, showError, setView } = ctx;
  const [onlyCompleted, setOnlyCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [failures, setFailures] = useState([]);
  const counts = useMemo(() => countStatuses(products), [products]);
  const unmapped = project.fields.filter((f) => !f.columnKey);
  const incomplete = useMemo(
    () => products.filter((p) => p.status === 'completed' && missingRequired(project, p).length),
    [project, products],
  );
  const st = imageSettings(project);

  async function doExport() {
    setBusy(true);
    setFailures([]);
    try {
      await saver.flush();
      const wb = await storage.getWorkbook(project.id);
      if (!wb) throw new Error('No workbook imported for this project.');
      const list = onlyCompleted ? products.filter((p) => p.status === 'completed') : products;
      const { bytes, cellsWritten, imagePlans } = buildExportWorkbook(wb.bytes, project, list);
      const base = safeFileName((project.fileName || project.name).replace(/\.(xlsx|xlsm|xls)$/i, ''));
      if (!st.downloadZip) {
        downloadBytes(bytes, `${base}-export.xlsx`, XLSX_MIME);
        notify('success', `Exported ${list.length} products (${cellsWritten} cells written).`);
        return;
      }
      const entries = [...imagePlans.values()].flat();
      const { files, report, failed } = await collectImages(entries, st, {
        onProgress: (done, total) => setProgress({ done, total }),
      });
      const zip = createZip([
        { name: `${base}-export.xlsx`, data: bytes },
        { name: 'image-report.csv', data: new TextEncoder().encode(reportCsv(report)) },
        ...files,
      ]);
      downloadBytes(zip, `${base}-export.zip`, 'application/zip');
      setFailures(failed);
      notify(
        failed.length ? 'error' : 'success',
        `Exported ${list.length} products and ${files.length} of ${report.length} images` +
          (failed.length ? ` – ${failed.length} image(s) could not be downloaded (see below and image-report.csv).` : '.'),
      );
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="view export-view">
      <section className="card">
        <h2>Export workbook</h2>
        <p className="small">
          {project.fileName} · worksheet <strong>{project.sheetName}</strong>
        </p>
        <ProgressBar counts={counts} />
        <ul className="stat-list" data-testid="export-stats">
          <li><span>Total</span><strong>{counts.total}</strong></li>
          <li><span>Completed</span><strong>{counts.completed}</strong></li>
          <li><span>In progress</span><strong>{counts.in_progress}</strong></li>
          <li><span>Pending</span><strong>{counts.pending}</strong></li>
          <li><span>Skipped</span><strong>{counts.skipped}</strong></li>
        </ul>
        {unmapped.length > 0 && (
          <p className="warn small">Not exported (no column): {unmapped.map((f) => f.label).join(', ')}</p>
        )}
        {incomplete.length > 0 && (
          <p className="warn small">{incomplete.length} completed product(s) have empty required fields.</p>
        )}
        <label className="check">
          <input type="checkbox" checked={onlyCompleted} onChange={(e) => setOnlyCompleted(e.target.checked)} data-testid="only-completed" />
          Only write data of completed products
        </label>
        <p className="muted small">
          All existing rows, columns and worksheets are kept. Configured columns are filled in (new columns are added at the end);
          empty values never erase existing cells. HTML is stored as plain text, never as a formula.
        </p>
        <p className="small" data-testid="export-image-summary">
          Images:{' '}
          {st.downloadZip ? 'downloaded and added to a ZIP with the workbook' : 'not downloaded'}
          {st.baseUrl ? ` · URLs point to ${st.baseUrl}` : ' · original URLs kept'}.{' '}
          <button className="link-btn" onClick={() => setView('fields')} data-testid="edit-image-settings">Change image settings</button>
        </p>
        <button className="btn primary" disabled={busy} onClick={doExport} data-testid="export-xlsx">
          {busy
            ? progress
              ? `Downloading images ${progress.done}/${progress.total}…`
              : 'Exporting…'
            : st.downloadZip
              ? 'Export .zip (workbook + images)'
              : 'Export .xlsx'}
        </button>
        {failures.length > 0 && (
          <ul className="warn small plain-list" data-testid="image-failures">
            {failures.map((f) => (
              <li key={f.fileName}>Row {f.rowIndex + 1} · {f.fileName}: {f.error} ({f.sourceUrl})</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
