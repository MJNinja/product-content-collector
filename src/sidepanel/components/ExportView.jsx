import { useMemo, useState } from 'react';
import * as storage from '../../services/storageService.js';
import { buildExportWorkbook, XLSX_MIME } from '../../services/excelService.js';
import { missingRequired, imageSettings } from '../../services/fieldService.js';
import { collectImages, createZip, reportCsv } from '../../services/imageService.js';
import { countStatuses, downloadBytes, safeFileName, ProgressBar } from './common.jsx';

function exportButtonText(busy, progress, downloadZip) {
  if (busy && progress) return `Downloading images ${progress.done}/${progress.total}…`;
  if (busy) return 'Exporting…';
  return downloadZip ? 'Export .zip (workbook + images)' : 'Export .xlsx';
}

/** Export tab: writes the collected data into the workbook (and optionally a ZIP with images). */
export default function ExportView({ ctx }) {
  const { project, products, saver, notify, showError, setView } = ctx;
  const [onlyCompleted, setOnlyCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [failures, setFailures] = useState([]);
  const counts = useMemo(() => countStatuses(products), [products]);
  const unmappedFields = project.fields.filter((field) => !field.columnKey);
  const incomplete = useMemo(
    () => products.filter((product) => product.status === 'completed' && missingRequired(project, product).length > 0),
    [project, products],
  );
  const settings = imageSettings(project);

  async function doExport() {
    setBusy(true);
    setFailures([]);
    try {
      await saver.flush();
      const workbook = await storage.getWorkbook(project.id);
      if (!workbook) throw new Error('No workbook imported for this project.');
      const exported = onlyCompleted ? products.filter((product) => product.status === 'completed') : products;
      const { bytes, cellsWritten, imagePlans } = buildExportWorkbook(workbook.bytes, project, exported);
      // "Products.xlsx" → "Products-export.xlsx"
      const baseName = safeFileName((project.fileName || project.name).replace(/\.(xlsx|xlsm|xls)$/i, ''));

      if (!settings.downloadZip) {
        downloadBytes(bytes, `${baseName}-export.xlsx`, XLSX_MIME);
        notify('success', `Exported ${exported.length} products (${cellsWritten} cells written).`);
        return;
      }

      // ZIP: workbook + image report + all images.
      const imageEntries = [...imagePlans.values()].flat();
      const { files, report, failed } = await collectImages(imageEntries, settings, {
        onProgress: (done, total) => setProgress({ done, total }),
      });
      const zip = createZip([
        { name: `${baseName}-export.xlsx`, data: bytes },
        { name: 'image-report.csv', data: new TextEncoder().encode(reportCsv(report)) },
        ...files,
      ]);
      downloadBytes(zip, `${baseName}-export.zip`, 'application/zip');
      setFailures(failed);
      let message = `Exported ${exported.length} products and ${files.length} of ${report.length} images`;
      if (failed.length) message += ` – ${failed.length} image(s) could not be downloaded (see below and image-report.csv).`;
      else message += '.';
      notify(failed.length ? 'error' : 'success', message);
    } catch (error) {
      showError(error);
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
        {unmappedFields.length > 0 && (
          <p className="warn small">Not exported (no column): {unmappedFields.map((field) => field.label).join(', ')}</p>
        )}
        {incomplete.length > 0 && (
          <p className="warn small">{incomplete.length} completed product(s) have empty required fields.</p>
        )}
        <label className="check">
          <input type="checkbox" checked={onlyCompleted} onChange={(event) => setOnlyCompleted(event.target.checked)} data-testid="only-completed" />
          Only write data of completed products
        </label>
        <p className="muted small">
          All existing rows, columns and worksheets are kept. Configured columns are filled in (new columns are added at the end);
          empty values never erase existing cells. HTML is stored as plain text, never as a formula.
        </p>
        <p className="small" data-testid="export-image-summary">
          Images:{' '}
          {settings.downloadZip ? 'downloaded and added to a ZIP with the workbook' : 'not downloaded'}
          {settings.baseUrl ? ` · URLs point to ${settings.baseUrl}` : ' · original URLs kept'}.{' '}
          <button className="link-btn" onClick={() => setView('fields')} data-testid="edit-image-settings">Change image settings</button>
        </p>
        <button className="btn primary" disabled={busy} onClick={doExport} data-testid="export-xlsx">
          {exportButtonText(busy, progress, settings.downloadZip)}
        </button>
        {failures.length > 0 && (
          <ul className="warn small plain-list" data-testid="image-failures">
            {failures.map((failure) => (
              <li key={failure.fileName}>Row {failure.rowIndex + 1} · {failure.fileName}: {failure.error} ({failure.sourceUrl})</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
