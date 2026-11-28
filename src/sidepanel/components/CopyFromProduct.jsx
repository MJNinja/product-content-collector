import { useState } from 'react';
import { copyableFields, copyProductData, hasCopyableData, productLabel } from '../../services/fieldService.js';
import { CollapsibleCard, ConfirmButton } from './common.jsx';

/**
 * Collect tab section: copies what was collected for a completed product into
 * the current one, for near-identical variants (another colour, small text
 * differences). Fields set to "Existing spreadsheet data" are never copied.
 */
export default function CopyFromProduct({ project, products, currentIndex, updateProduct, notify }) {
  // Completed products other than the current one, with their position for the label.
  const sources = products
    .map((product, index) => ({ product, index }))
    .filter(({ product, index }) => product.status === 'completed' && index !== currentIndex);

  const [chosenIndex, setChosenIndex] = useState('');
  const [includeImages, setIncludeImages] = useState(false);

  // Use the chosen product while it is still in the list (it may have become
  // the current product, or been reopened); otherwise the first one.
  const chosenIsAvailable = sources.some(({ index }) => String(index) === chosenIndex);
  const firstAvailable = sources.length ? String(sources[0].index) : '';
  const sourceIndex = chosenIsAvailable ? chosenIndex : firstAvailable;

  const hasImageFields = project.fields.some((field) => field.kind === 'image' && field.method === 'visual');
  const options = { includeImages: hasImageFields && includeImages };
  const current = products[currentIndex];

  const copy = () => {
    const source = products[Number(sourceIndex)];
    if (!source) return;
    updateProduct(currentIndex, (product) => ({ ...product, data: copyProductData(project, source, product, options) }));
    const fieldCount = copyableFields(project, options).length;
    notify('success', `Copied ${fieldCount} field(s) from product ${Number(sourceIndex) + 1} (${productLabel(project, source)}). Adjust what differs.`);
  };

  return (
    <CollapsibleCard id="collect-copy" defaultCollapsed title="Copy from a completed product" testId="copy-from">
      {sources.length === 0 ? (
        <p className="muted small">No completed products to copy from yet.</p>
      ) : (
        <>
          <p className="muted small">
            Copies the selected and typed fields into this product so you only adjust what differs.
            Spreadsheet fields and the image file name are not copied.
          </p>
          <div className="row wrap copy-from">
            <select
              className="grow"
              value={sourceIndex}
              onChange={(event) => setChosenIndex(event.target.value)}
              aria-label="Product to copy from"
              data-testid="copy-source"
            >
              {sources.map(({ product, index }) => (
                <option key={product.rowIndex} value={index}>
                  {index + 1}. {productLabel(project, product).slice(0, 40)}
                </option>
              ))}
            </select>
            {hasImageFields && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={includeImages}
                  onChange={(event) => setIncludeImages(event.target.checked)}
                  data-testid="copy-include-images"
                />
                Include images
              </label>
            )}
            {hasCopyableData(project, current, options) ? (
              <ConfirmButton className="btn small" confirmText="Replace current data?" onConfirm={copy} testId="copy-apply">
                Copy
              </ConfirmButton>
            ) : (
              <button className="btn small" onClick={copy} data-testid="copy-apply">Copy</button>
            )}
          </div>
        </>
      )}
    </CollapsibleCard>
  );
}
