import { useMemo, useState } from 'react';
import { computeRow, missingRequired, columnName, oversizedCells, planProductImages, autoImageBaseName } from '../../services/fieldService.js';
import { sameDocument } from '../../utils/url.js';
import { StatusBadge, STATUS_LABELS, countStatuses, ProgressBar } from './common.jsx';
import { FieldEditor } from './FieldEditors.jsx';

function productLabel(project, product) {
  // Prefer the first non-URL value of the row (often a SKU or name) as a label.
  const urlCol = project.columns.find((c) => c.key === project.urlColumnKey);
  const firstCol = project.columns.find((c) => c.index != null && c !== urlCol && product.source && product.source[c.index]);
  return firstCol ? String(product.source[firstCol.index]) : product.url || `Row ${product.rowIndex + 1}`;
}

function RowPreview({ project, product }) {
  const row = useMemo(() => computeRow(project, product), [project, product]);
  const entries = Object.entries(row);
  if (!entries.length) return <p className="muted small">No fields are mapped to columns yet.</p>;
  return (
    <table className="row-preview" data-testid="row-preview">
      <tbody>
        {entries.map(([key, cell]) => (
          <tr key={key} data-column={columnName(project, key)}>
            <th>{columnName(project, key)}</th>
            <td>
              {cell.value ? <pre>{cell.value.length > 600 ? `${cell.value.slice(0, 600)}…` : cell.value}</pre> : <span className="muted">(empty – existing cell kept)</span>}
              {!cell.write && cell.value && <span className="muted small"> · unchanged from spreadsheet</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ImageFiles({ project, product, onChange }) {
  const plan = useMemo(() => planProductImages(project, product), [project, product]);
  const auto = autoImageBaseName(project, product);
  return (
    <section className="card image-files" data-testid="image-files">
      <label className="inline-label">
        Image file name
        <input
          value={product.imageName || ''}
          placeholder={auto}
          onChange={(e) => onChange(e.target.value)}
          data-testid="image-name"
        />
      </label>
      {plan.length > 0 ? (
        <ul className="plain-list small" data-testid="image-file-list">
          {plan.map((e) => (
            <li key={`${e.fieldId}:${e.imageId}`}>
              <code>{e.fileName}</code>
              {e.publicUrl && <span className="muted"> → {e.publicUrl}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Leave empty to use “{auto}”. Main image gets “-main”, gallery images “-1”, “-2”…</p>
      )}
    </section>
  );
}

export default function CollectView({ ctx }) {
  const { project, products, currentIndex, tab, selecting, updateField, setFieldData, toggleSelect, goTo, openInTab, completeCurrent, updateProduct, setView } = ctx;
  const [showPreview, setShowPreview] = useState(true);
  const counts = useMemo(() => countStatuses(products), [products]);

  if (!products.length) {
    return (
      <div className="view">
        <section className="card">
          <p>No products yet. Import a workbook first.</p>
          <button className="btn primary" onClick={() => setView('import')}>Import workbook</button>
        </section>
      </div>
    );
  }
  const product = products[currentIndex];
  const missing = missingRequired(project, product);
  const oversized = oversizedCells(project, product);
  const tabMismatch = tab && product.url && tab.url && !sameDocument(tab.url, product.url);

  return (
    <div className="view collect-view">
      <section className="card product-nav">
        <div className="row space">
          <div>
            <span className="counter" data-testid="product-counter">
              Product {currentIndex + 1} of {products.length}
            </span>{' '}
            <StatusBadge status={product.status} />
          </div>
          <select
            className="jump"
            value={currentIndex}
            onChange={(e) => goTo(Number(e.target.value))}
            aria-label="Jump to product"
            data-testid="product-jump"
          >
            {products.map((p, i) => (
              <option key={p.rowIndex} value={i}>
                {i + 1}. {productLabel(project, p).slice(0, 40)} – {STATUS_LABELS[p.status]}
              </option>
            ))}
          </select>
        </div>
        <ProgressBar counts={counts} />
        <div className="product-url" data-testid="product-url">
          {product.url ? (
            <a href={product.url} onClick={(e) => { e.preventDefault(); openInTab(product); }} title="Open in the current tab">{product.url}</a>
          ) : (
            <span className="warn">No valid URL in row {product.rowIndex + 1}{product.rawUrl ? ` ("${product.rawUrl}")` : ''}</span>
          )}
        </div>
        {tabMismatch && (
          <p className="warn small" data-testid="tab-mismatch">
            The tab shows a different page ({tab.url}). Selections are still saved to this product.{' '}
            <button className="link-btn" onClick={() => openInTab(product)}>Open product page</button>
          </p>
        )}
        <div className="row wrap nav-buttons">
          <button className="btn" disabled={currentIndex === 0} onClick={() => goTo(currentIndex - 1)} data-testid="prev">← Previous</button>
          <button className="btn" onClick={() => openInTab(product)} disabled={!product.url} data-testid="open">Open</button>
          <button className="btn" onClick={() => goTo(currentIndex + 1, { statusForCurrent: 'skipped' })} data-testid="skip">Skip</button>
          <button className="btn" disabled={currentIndex >= products.length - 1} onClick={() => goTo(currentIndex + 1)} data-testid="next">Next →</button>
        </div>
      </section>

      <section className="card">
        {project.fields.length === 0 && (
          <p className="muted">
            No fields configured. <button className="link-btn" onClick={() => setView('fields')}>Configure fields</button>
          </p>
        )}
        {project.fields.map((f) => (
          <FieldEditor
            key={`${product.rowIndex}:${f.id}`}
            project={project}
            field={f}
            product={product}
            onChange={(v) => setFieldData(currentIndex, f.id, v)}
            selecting={selecting}
            onToggleSelect={toggleSelect}
            onFieldChange={(patch) => updateField(f.id, patch)}
          />
        ))}
      </section>

      {project.fields.some((f) => f.kind === 'image' && f.method === 'visual') && (
        <ImageFiles project={project} product={product} onChange={(v) => updateProduct(currentIndex, { imageName: v })} />
      )}

      <section className="card">
        <button className="link-btn" onClick={() => setShowPreview(!showPreview)}>{showPreview ? '▾' : '▸'} Spreadsheet output for this product</button>
        {showPreview && <RowPreview project={project} product={product} />}
      </section>

      <section className="card sticky-actions">
        {missing.length > 0 && <p className="warn small">Required: {missing.join(', ')}</p>}
        {oversized.length > 0 && <p className="warn small">Over Excel's 32,767 character cell limit: {oversized.join(', ')}</p>}
        <div className="row wrap">
          {product.status === 'completed' ? (
            <button className="btn" onClick={() => updateProduct(currentIndex, { status: 'in_progress' })} data-testid="reopen">Reopen for editing</button>
          ) : (
            <button className="btn" onClick={() => completeCurrent(false)} data-testid="complete">Mark completed</button>
          )}
          <button className="btn primary grow" onClick={() => completeCurrent(true)} disabled={currentIndex >= products.length - 1 && product.status === 'completed'} data-testid="complete-next">
            {currentIndex >= products.length - 1 ? 'Complete' : 'Complete & next →'}
          </button>
        </div>
      </section>
    </div>
  );
}
