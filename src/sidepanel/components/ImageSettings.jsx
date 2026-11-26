import { useMemo } from 'react';
import { IMAGE_FORMATS, imageSettings, planAllImages, columnName } from '../../services/fieldService.js';
import { CollapsibleCard } from './common.jsx';

/** Image export settings: file naming, new URL location, resizing / format, ZIP download. */
export default function ImageSettings({ project, products, updateProject }) {
  const settings = imageSettings(project);
  const set = (changes) =>
    updateProject((current) => ({ ...current, imageSettings: { ...imageSettings(current), ...changes } }));
  const hasImageFields = project.fields.some((field) => field.kind === 'image' && field.method === 'visual');
  const { plans, duplicates } = useMemo(() => planAllImages(project, products), [project, products]);

  // Up to three file names of the first product that has images, as an example.
  const exampleFiles = useMemo(() => {
    for (const productFiles of plans.values()) {
      if (productFiles.length) return productFiles.slice(0, 3);
    }
    return [];
  }, [plans]);
  const totalImages = useMemo(() => {
    let count = 0;
    for (const productFiles of plans.values()) count += productFiles.length;
    return count;
  }, [plans]);
  const isOriginal = settings.format === 'original';

  // One-line summary shown when the section is collapsed.
  const sizeText = isOriginal ? 'original files' : `${settings.format.toUpperCase()} max ${settings.maxWidth || '∞'}×${settings.maxHeight || '∞'}`;
  const summary = [
    settings.nameColumnKey ? `named after ${columnName(project, settings.nameColumnKey)}` : 'named by row',
    sizeText,
    settings.baseUrl ? `→ ${settings.baseUrl}` : 'original URLs',
    settings.downloadZip ? 'ZIP on export' : 'no ZIP',
  ].join(' · ');

  const duplicatesText = duplicates
    .map((duplicate) => `${duplicate.fileName} (rows ${duplicate.rows.map((rowIndex) => rowIndex + 1).join(', ')})`)
    .join('; ');

  return (
    <CollapsibleCard
      id="fields-images"
      title="Image settings"
      testId="image-settings"
      summary={summary}
    >
      <p className="muted small">Applies to all image fields of this project. Set this up before collecting; it can be changed any time before exporting.</p>
      {!hasImageFields && <p className="muted small">No image fields are configured.</p>}
      <div className="form-grid">
        <label className="span2">
          Name image files after column
          <select value={settings.nameColumnKey || ''} onChange={(event) => set({ nameColumnKey: event.target.value })} data-testid="image-name-column">
            <option value="">— none (use the row number) —</option>
            {project.columns.map((column) => (
              <option key={column.key} value={column.key}>{column.name}</option>
            ))}
          </select>
          <span className="hint">The name can be changed per product in the Collect tab. Main image: <code>name-main</code>, gallery: <code>name-1</code>, <code>name-2</code>…</span>
        </label>
        <label className="span2">
          New image location (URL written to the spreadsheet)
          <input
            value={settings.baseUrl}
            onChange={(event) => set({ baseUrl: event.target.value.trim() })}
            placeholder="https://www.example.com/images/   (empty = keep original URLs)"
            data-testid="image-base-url"
          />
        </label>
        <label>
          Format
          <select value={settings.format} onChange={(event) => set({ format: event.target.value })} data-testid="image-format">
            {IMAGE_FORMATS.map((format) => (
              <option key={format.value} value={format.value}>{format.label}</option>
            ))}
          </select>
        </label>
        <label>
          Quality (1–100)
          <input type="number" min="1" max="100" value={settings.quality} disabled={isOriginal || settings.format === 'png'} onChange={(event) => set({ quality: Number(event.target.value) })} data-testid="image-quality" />
        </label>
        <label>
          Max width (px)
          <input type="number" min="0" value={settings.maxWidth} disabled={isOriginal} onChange={(event) => set({ maxWidth: Number(event.target.value) })} data-testid="image-max-width" />
        </label>
        <label>
          Max height (px)
          <input type="number" min="0" value={settings.maxHeight} disabled={isOriginal} onChange={(event) => set({ maxHeight: Number(event.target.value) })} data-testid="image-max-height" />
        </label>
        <div className="checks span2">
          <label className="check">
            <input type="checkbox" checked={settings.lowercase} onChange={(event) => set({ lowercase: event.target.checked })} data-testid="image-lowercase" />
            Lowercase file names
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.downloadZip} onChange={(event) => set({ downloadZip: event.target.checked })} data-testid="image-download-zip" />
            Download images as ZIP on export (workbook + images)
          </label>
        </div>
      </div>
      <p className="muted small">
        Images are only made smaller, never larger (0 = no limit). JPG gets a white background where the original is transparent.
      </p>
      {exampleFiles.length > 0 && (
        <div className="small" data-testid="image-example">
          Example ({totalImages} images in total):
          <ul className="plain-list">
            {exampleFiles.map((file) => (
              <li key={file.fileName}>
                <code>{file.fileName}</code>
                {file.publicUrl && <> → <code>{file.publicUrl}</code></>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {duplicates.length > 0 && (
        <p className="warn small" data-testid="image-duplicates">
          Same file name for different images: {duplicatesText}.
          Later ones get “-row&lt;N&gt;” added. Set a different image name in the Collect tab to avoid this.
        </p>
      )}
    </CollapsibleCard>
  );
}
