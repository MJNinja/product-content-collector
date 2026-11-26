import { defaultColumnFormat, encodeSeparator, decodeSeparator } from '../../services/fieldService.js';
import { CollapsibleCard } from './common.jsx';

/** One destination column: how the values of its fields are combined, with a preview. */
function FormatRow({ column, fieldLabels, format, previewValue, onChange }) {
  const severalFields = fieldLabels.length > 1;
  return (
    <div className="format-row" data-testid="format-row">
      <div className="format-title">
        <strong>{column.name}</strong> <span className="muted small">← {fieldLabels.join(' + ')}</span>
      </div>
      <div className="form-grid">
        <label>
          Combine as
          <select value={format.mode} onChange={(event) => onChange({ mode: event.target.value })} data-testid="format-mode">
            <option value="join">Separated list (a, b, c)</option>
            <option value="path">One path (a &gt; b &gt; c)</option>
            {severalFields && <option value="prefix">Path per value of last field (a &gt; b1, a &gt; b2)</option>}
          </select>
        </label>
        {format.mode !== 'path' && (
          <label>
            {severalFields ? 'Separator between fields' : 'Separator'}
            <input
              value={encodeSeparator(format.separator)}
              onChange={(event) => onChange({ separator: decodeSeparator(event.target.value) })}
              data-testid="format-separator"
            />
          </label>
        )}
        {format.mode !== 'join' && (
          <label>
            Path separator
            <input
              value={encodeSeparator(format.pathSeparator)}
              onChange={(event) => onChange({ pathSeparator: decodeSeparator(event.target.value) })}
              data-testid="format-path-separator"
            />
          </label>
        )}
      </div>
      <pre className="cell-preview" data-testid="format-preview">{previewValue || '(empty for current product)'}</pre>
    </div>
  );
}

/**
 * The "Cell formatting" section of the Fields tab.
 * fieldsByColumn: Map(columnKey → labels of the fields writing to it).
 * previewRow: computeRow() result for the current product.
 */
export default function CellFormatting({ project, product, fieldsByColumn, previewRow, updateProject }) {
  const setFormat = (columnKey, changes) =>
    updateProject((current) => {
      const formats = current.columnFormats || {};
      const updated = { ...defaultColumnFormat(), ...formats[columnKey], ...changes };
      return { ...current, columnFormats: { ...current.columnFormats, [columnKey]: updated } };
    });

  return (
    <CollapsibleCard
      id="fields-formatting"
      defaultCollapsed
      title="Cell formatting"
      summary={`${fieldsByColumn.size} columns receive values`}
      testId="section-formatting"
    >
      <p className="muted small">
        How values are combined in each destination column. Preview uses the current product{product ? ` (row ${product.rowIndex + 1})` : ''}.
      </p>
      {[...fieldsByColumn.entries()].map(([columnKey, fieldLabels]) => {
        const column = project.columns.find((candidate) => candidate.key === columnKey);
        if (!column) return null;
        const format = { ...defaultColumnFormat(), ...(project.columnFormats || {})[columnKey] };
        const previewCell = previewRow[columnKey];
        return (
          <FormatRow
            key={columnKey}
            column={column}
            fieldLabels={fieldLabels}
            format={format}
            previewValue={previewCell ? previewCell.value : ''}
            onChange={(changes) => setFormat(columnKey, changes)}
          />
        );
      })}
      {!fieldsByColumn.size && <p className="muted">Map fields to columns to configure formatting.</p>}
    </CollapsibleCard>
  );
}
