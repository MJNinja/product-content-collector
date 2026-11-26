import { useMemo, useState } from 'react';
import { createField, createPresetField, PRESET_LABELS, computeRow, suggestFields, labelColumn, productLabel } from '../../services/fieldService.js';
import { newColumn } from '../../services/excelService.js';
import { normalizeProductUrl } from '../../utils/url.js';
import { moveItem } from '../../services/htmlService.js';
import { CollapsibleCard } from './common.jsx';
import ImageSettings from './ImageSettings.jsx';
import FieldCard from './FieldCard.jsx';
import CellFormatting from './CellFormatting.jsx';

const AUTOMATIC = '__auto__';

/** "was "Name"", "new column" or "existing" next to a column in the list. */
function columnOrigin(column) {
  if (column.index == null) return 'new column';
  if (column.originalName !== column.name) return `was "${column.originalName}"`;
  return 'existing';
}

/**
 * Fields tab: four collapsible sections – Columns, Fields, Image settings and
 * Cell formatting. Every change is saved through updateProject (autosave).
 */
export default function FieldsView({ ctx }) {
  const { project, products, currentIndex, updateProject, setProducts, setView, saver } = ctx;
  const [newColumnName, setNewColumnName] = useState('');
  const fields = project.fields || [];
  const product = products[currentIndex];

  /** Adds a column (or reuses one with the same name) and returns its key. */
  const addColumn = (name) => {
    const existing = project.columns.find((column) => column.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.key;
    const column = newColumn(name);
    updateProject((current) => ({ ...current, columns: [...current.columns, column] }));
    return column.key;
  };

  // Helpers that change the list of fields.
  const setFields = (makeNewFields) =>
    updateProject((current) => ({ ...current, fields: makeNewFields(current.fields, current) }));
  const updateField = (index, newField) => setFields((list) => list.map((field, i) => (i === index ? newField : field)));
  const removeField = (index) => setFields((list) => list.filter((_, i) => i !== index));
  const moveField = (from, to) => setFields((list) => moveItem(list, from, to));
  const addField = () => setFields((list) => [...list, createField({ label: `Field ${list.length + 1}` })]);
  const addPreset = (label) => {
    if (!label) return;
    setFields((list, current) => [...list, createPresetField(label, current.columns, current.urlColumnKey)]);
  };
  const addSuggested = () => setFields((list, current) => [...list, ...suggestFields(current.columns, current.urlColumnKey)]);

  const renameColumn = (columnKey, name) =>
    updateProject((current) => ({
      ...current,
      columns: current.columns.map((column) => (column.key === columnKey ? { ...column, name } : column)),
    }));

  // Removing a column also unmaps the fields that wrote to it.
  const removeColumn = (columnKey) =>
    updateProject((current) => ({
      ...current,
      columns: current.columns.filter((column) => column.key !== columnKey),
      fields: current.fields.map((field) => (field.columnKey === columnKey ? { ...field, columnKey: null } : field)),
    }));

  // A different URL column changes every product's URL.
  const changeUrlColumn = async (columnKey) => {
    const column = project.columns.find((candidate) => candidate.key === columnKey);
    if (!column || column.index == null) return;
    updateProject({ urlColumnKey: columnKey });
    const updatedProducts = products.map((item) => {
      const rawUrl = (item.source && item.source[column.index]) || '';
      return { ...item, url: normalizeProductUrl(rawUrl) || '', rawUrl };
    });
    setProducts(updatedProducts);
    for (const item of updatedProducts) saver.schedule(`product:${item.rowIndex}`, { kind: 'product', value: item });
  };

  // Columns that receive values from fields: Map(columnKey → field labels).
  const fieldsByColumn = useMemo(() => {
    const map = new Map();
    for (const field of fields) {
      if (!field.columnKey) continue;
      map.set(field.columnKey, [...(map.get(field.columnKey) || []), field.label]);
    }
    return map;
  }, [fields]);

  const automaticLabelColumn = labelColumn({ ...project, labelColumnKey: null });
  const spreadsheetColumns = project.columns.filter((column) => column.index != null);
  const identifierExample = product ? productLabel(project, product).slice(0, 40) : 'TV001';

  const previewRow = useMemo(() => (product ? computeRow(project, product) : {}), [project, product]);

  return (
    <div className="view fields-view">
      <CollapsibleCard id="fields-columns" title="Columns" summary={`${project.columns.length} columns`} testId="section-columns">
        <p className="muted small">Rename destination columns or add new ones. Original data in every column is preserved on export.</p>
        <label className="inline-label">
          Product URL column
          <select value={project.urlColumnKey || ''} onChange={(event) => changeUrlColumn(event.target.value)} data-testid="fields-url-column">
            {spreadsheetColumns.map((column) => (
              <option key={column.key} value={column.key}>{column.name}</option>
            ))}
          </select>
        </label>
        <label className="inline-label">
          Product identifier
          <select
            value={project.labelColumnKey == null ? AUTOMATIC : project.labelColumnKey}
            onChange={(event) => updateProject({ labelColumnKey: event.target.value === AUTOMATIC ? null : event.target.value })}
            data-testid="label-column"
          >
            <option value={AUTOMATIC}>Automatic{automaticLabelColumn ? ` (${automaticLabelColumn.name})` : ''}</option>
            {spreadsheetColumns
              .filter((column) => column.key !== project.urlColumnKey)
              .map((column) => (
                <option key={column.key} value={column.key}>{column.name}</option>
              ))}
            <option value="">None (show the URL)</option>
          </select>
        </label>
        <p className="muted small hint">Shown in the Collect tab's "jump to product" list, e.g. "5. {identifierExample}".</p>
        <ul className="column-list">
          {project.columns.map((column) => (
            <li key={column.key} data-testid="column-item">
              <input value={column.name} onChange={(event) => renameColumn(column.key, event.target.value)} aria-label="Column name" data-testid="column-name" />
              <span className="muted small">
                {columnOrigin(column)}
                {fieldsByColumn.has(column.key) && ` · ← ${fieldsByColumn.get(column.key).join(', ')}`}
              </span>
              {column.index == null && (
                <button className="icon-btn" title="Remove column" onClick={() => removeColumn(column.key)}>✕</button>
              )}
            </li>
          ))}
        </ul>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            if (newColumnName.trim()) addColumn(newColumnName.trim());
            setNewColumnName('');
          }}
        >
          <input className="grow" placeholder="New column name" value={newColumnName} onChange={(event) => setNewColumnName(event.target.value)} data-testid="new-column-name" />
          <button className="btn small" type="submit" data-testid="add-column">Add column</button>
        </form>
      </CollapsibleCard>

      <CollapsibleCard
        id="fields-fields"
        title="Fields"
        summary={`${fields.length} fields: ${fields.map((field) => field.label).join(', ')}`}
        testId="section-fields"
        actions={
          <div className="row">
            {!fields.length && <button className="btn small" onClick={addSuggested}>Add suggested fields</button>}
            <select
              className="preset-select"
              value=""
              onChange={(event) => addPreset(event.target.value)}
              aria-label="Add a ready-made field"
              data-testid="add-preset"
            >
              <option value="">+ Ready-made field…</option>
              {PRESET_LABELS.map((label) => (
                <option key={label} value={label}>{label}</option>
              ))}
            </select>
            <button className="btn small primary" onClick={addField} data-testid="add-field">+ Add field</button>
          </div>
        }
      >
        <p className="muted small">
          Each field is captured manually, by visual selection on the page, or kept from the spreadsheet. Several fields may share one column.
        </p>
        <ul className="field-list">
          {fields.map((field, index) => (
            <FieldCard
              key={field.id}
              project={project}
              field={field}
              index={index}
              count={fields.length}
              update={(newField) => updateField(index, newField)}
              remove={() => removeField(index)}
              move={moveField}
              addColumn={addColumn}
            />
          ))}
        </ul>
      </CollapsibleCard>

      <ImageSettings project={project} products={products} updateProject={updateProject} />

      <CellFormatting
        project={project}
        product={product}
        fieldsByColumn={fieldsByColumn}
        previewRow={previewRow}
        updateProject={updateProject}
      />

      <div className="footer-actions">
        <button className="btn primary" onClick={() => setView('collect')} data-testid="go-collect">Start collecting →</button>
      </div>
    </div>
  );
}
