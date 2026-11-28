import { useMemo, useState } from 'react';
import { computeRow, productLabel, missingRequired, columnName, oversizedCells, planProductImages, autoImageBaseName } from '../../services/fieldService.js';
import { sameDocument } from '../../utils/url.js';
import { StatusBadge, STATUS_LABELS, countStatuses, ProgressBar } from './common.jsx';
import { FieldEditor } from './FieldEditors.jsx';
import CopyFromProduct from './CopyFromProduct.jsx';

const PREVIEW_MAX_CHARACTERS = 600;

/** Long cell values are shortened in the preview. */
function shorten(text) {
  return text.length > PREVIEW_MAX_CHARACTERS ? `${text.slice(0, PREVIEW_MAX_CHARACTERS)}…` : text;
}

/** Table of what will be written to each column for this product. */
function RowPreview({ project, product }) {
  const row = useMemo(() => computeRow(project, product), [project, product]);
  const entries = Object.entries(row);
  if (!entries.length) return <p className="muted small">No fields are mapped to columns yet.</p>;
  return (
    <table className="row-preview" data-testid="row-preview">
      <tbody>
        {entries.map(([columnKey, cell]) => (
          <tr key={columnKey} data-column={columnName(project, columnKey)}>
            <th>{columnName(project, columnKey)}</th>
            <td>
              {cell.value && <pre>{shorten(cell.value)}</pre>}
              {!cell.value && <span className="muted">(empty – existing cell kept)</span>}
              {!cell.write && cell.value && <span className="muted small"> · unchanged from spreadsheet</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** File name input and the resulting image file names for this product. */
function ImageFiles({ project, product, onChange }) {
  const plannedFiles = useMemo(() => planProductImages(project, product), [project, product]);
  const automaticName = autoImageBaseName(project, product);
  return (
    <section className="card image-files" data-testid="image-files">
      <label className="inline-label">
        Image file name
        <input
          value={product.imageName || ''}
          placeholder={automaticName}
          onChange={(event) => onChange(event.target.value)}
          data-testid="image-name"
        />
      </label>
      {plannedFiles.length > 0 ? (
        <ul className="plain-list small" data-testid="image-file-list">
          {plannedFiles.map((file) => (
            <li key={`${file.fieldId}:${file.imageId}`}>
              <code>{file.fileName}</code>
              {file.publicUrl && <span className="muted"> → {file.publicUrl}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Leave empty to use “{automaticName}”. Main image gets “-main”, gallery images “-1”, “-2”…</p>
      )}
    </section>
  );
}

/** Collect tab: product navigation, the field editors and the output preview. */
export default function CollectView({ ctx }) {
  const {
    project, products, currentIndex, tab, selecting,
    updateField, setFieldData, toggleSelect, goTo, openInTab, completeCurrent, updateProduct, setView, notify,
  } = ctx;
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
  const isLastProduct = currentIndex >= products.length - 1;
  const hasImageFields = project.fields.some((field) => field.kind === 'image' && field.method === 'visual');
  // The browser tab shows another page than this product's (e.g. the user clicked a link).
  const tabMismatch = tab && product.url && tab.url && !sameDocument(tab.url, product.url);

  return (
    <div className="view collect-view">
      <section className="card product-nav">
        <div className="row space">
          <div className="counter-block">
            <span className="counter" data-testid="product-counter">
              Product {currentIndex + 1} of {products.length}
            </span>
            <StatusBadge status={product.status} />
          </div>
          <select
            className="jump"
            value={currentIndex}
            onChange={(event) => goTo(Number(event.target.value))}
            aria-label="Jump to product"
            data-testid="product-jump"
          >
            {products.map((item, index) => (
              <option key={item.rowIndex} value={index}>
                {index + 1}. {productLabel(project, item).slice(0, 40)} – {STATUS_LABELS[item.status]}
              </option>
            ))}
          </select>
        </div>
        <ProgressBar counts={counts} />
        <div className="product-url" data-testid="product-url">
          {product.url ? (
            <a
              href={product.url}
              onClick={(event) => {
                event.preventDefault();
                openInTab(product);
              }}
              title="Open in the current tab"
            >
              {product.url}
            </a>
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
          <button className="btn" disabled={isLastProduct} onClick={() => goTo(currentIndex + 1)} data-testid="next">Next →</button>
        </div>
      </section>

      <CopyFromProduct
        project={project}
        products={products}
        currentIndex={currentIndex}
        updateProduct={updateProduct}
        notify={notify}
      />

      <section className="card">
        {project.fields.length === 0 && (
          <p className="muted">
            No fields configured. <button className="link-btn" onClick={() => setView('fields')}>Configure fields</button>
          </p>
        )}
        {project.fields.map((field) => (
          <FieldEditor
            key={`${product.rowIndex}:${field.id}`}
            project={project}
            field={field}
            product={product}
            onChange={(value) => setFieldData(currentIndex, field.id, value)}
            selecting={selecting}
            onToggleSelect={toggleSelect}
            onFieldChange={(changes) => updateField(field.id, changes)}
          />
        ))}
      </section>

      {hasImageFields && (
        <ImageFiles project={project} product={product} onChange={(imageName) => updateProduct(currentIndex, { imageName })} />
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
          <button
            className="btn primary grow"
            onClick={() => completeCurrent(true)}
            disabled={isLastProduct && product.status === 'completed'}
            data-testid="complete-next"
          >
            {isLastProduct ? 'Complete' : 'Complete & next →'}
          </button>
        </div>
      </section>
    </div>
  );
}
