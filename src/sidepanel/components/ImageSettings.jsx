import { useMemo } from 'react';
import { IMAGE_FORMATS, imageSettings, planAllImages, columnName } from '../../services/fieldService.js';
import { CollapsibleCard } from './common.jsx';

/** Image export settings: file naming, new URL location, resizing / format, ZIP download. */
export default function ImageSettings({ project, products, updateProject }) {
  const st = imageSettings(project);
  const set = (patch) => updateProject((p) => ({ ...p, imageSettings: { ...imageSettings(p), ...patch } }));
  const hasImageFields = project.fields.some((f) => f.kind === 'image' && f.method === 'visual');
  const { plans, duplicates } = useMemo(() => planAllImages(project, products), [project, products]);
  const example = useMemo(() => {
    for (const entries of plans.values()) if (entries.length) return entries.slice(0, 3);
    return [];
  }, [plans]);
  const total = useMemo(() => [...plans.values()].reduce((n, e) => n + e.length, 0), [plans]);
  const isOriginal = st.format === 'original';

  return (
    <CollapsibleCard
      id="fields-images"
      title="Image settings"
      testId="image-settings"
      summary={[
        st.nameColumnKey ? `named after ${columnName(project, st.nameColumnKey)}` : 'named by row',
        isOriginal ? 'original files' : `${st.format.toUpperCase()} max ${st.maxWidth || '∞'}×${st.maxHeight || '∞'}`,
        st.baseUrl ? `→ ${st.baseUrl}` : 'original URLs',
        st.downloadZip ? 'ZIP on export' : 'no ZIP',
      ].join(' · ')}
    >
      <p className="muted small">Applies to all image fields of this project. Set this up before collecting; it can be changed any time before exporting.</p>
      {!hasImageFields && <p className="muted small">No image fields are configured.</p>}
      <div className="form-grid">
        <label className="span2">
          Name image files after column
          <select value={st.nameColumnKey || ''} onChange={(e) => set({ nameColumnKey: e.target.value })} data-testid="image-name-column">
            <option value="">— none (use the row number) —</option>
            {project.columns.map((c) => (
              <option key={c.key} value={c.key}>{c.name}</option>
            ))}
          </select>
          <span className="hint">The name can be changed per product in the Collect tab. Main image: <code>name-main</code>, gallery: <code>name-1</code>, <code>name-2</code>…</span>
        </label>
        <label className="span2">
          New image location (URL written to the spreadsheet)
          <input
            value={st.baseUrl}
            onChange={(e) => set({ baseUrl: e.target.value.trim() })}
            placeholder="https://www.example.com/images/   (empty = keep original URLs)"
            data-testid="image-base-url"
          />
        </label>
        <label>
          Format
          <select value={st.format} onChange={(e) => set({ format: e.target.value })} data-testid="image-format">
            {IMAGE_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </label>
        <label>
          Quality (1–100)
          <input type="number" min="1" max="100" value={st.quality} disabled={isOriginal || st.format === 'png'} onChange={(e) => set({ quality: Number(e.target.value) })} data-testid="image-quality" />
        </label>
        <label>
          Max width (px)
          <input type="number" min="0" value={st.maxWidth} disabled={isOriginal} onChange={(e) => set({ maxWidth: Number(e.target.value) })} data-testid="image-max-width" />
        </label>
        <label>
          Max height (px)
          <input type="number" min="0" value={st.maxHeight} disabled={isOriginal} onChange={(e) => set({ maxHeight: Number(e.target.value) })} data-testid="image-max-height" />
        </label>
        <div className="checks span2">
          <label className="check">
            <input type="checkbox" checked={st.lowercase} onChange={(e) => set({ lowercase: e.target.checked })} data-testid="image-lowercase" />
            Lowercase file names
          </label>
          <label className="check">
            <input type="checkbox" checked={st.downloadZip} onChange={(e) => set({ downloadZip: e.target.checked })} data-testid="image-download-zip" />
            Download images as ZIP on export (workbook + images)
          </label>
        </div>
      </div>
      <p className="muted small">
        Images are only made smaller, never larger (0 = no limit). JPG gets a white background where the original is transparent.
      </p>
      {example.length > 0 && (
        <div className="small" data-testid="image-example">
          Example ({total} images in total):
          <ul className="plain-list">
            {example.map((e) => (
              <li key={e.fileName}>
                <code>{e.fileName}</code>
                {e.publicUrl && <> → <code>{e.publicUrl}</code></>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {duplicates.length > 0 && (
        <p className="warn small" data-testid="image-duplicates">
          Same file name for different images: {duplicates.map((d) => `${d.fileName} (rows ${d.rows.map((r) => r + 1).join(', ')})`).join('; ')}.
          Later ones get “-row&lt;N&gt;” added. Set a different image name in the Collect tab to avoid this.
        </p>
      )}
    </CollapsibleCard>
  );
}
