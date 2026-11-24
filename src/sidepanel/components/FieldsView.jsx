import { useMemo, useState } from 'react';
import {
  METHODS, KINDS, createField, createPresetField, PRESET_LABELS, imageRole, defaultSeparator, defaultColumnFormat, computeRow, encodeSeparator, decodeSeparator, suggestFields,
} from '../../services/fieldService.js';
import { newColumn } from '../../services/excelService.js';
import { normalizeProductUrl } from '../../utils/url.js';
import { moveItem } from '../../services/htmlService.js';
import { ConfirmButton, CollapsibleCard } from './common.jsx';
import ImageSettings from './ImageSettings.jsx';
import { CAPTURE_MODES } from './FieldEditors.jsx';

/** Column dropdown that also lets the user create a new column inline. */
function ColumnSelect({ project, value, onChange, onCreate, allowNone = true, testId, excludeUrl = true }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  if (adding) {
    const submit = () => {
      const n = name.trim();
      if (n) onCreate(n);
      setAdding(false);
      setName('');
    };
    return (
      <span className="row">
        <input
          autoFocus
          className="grow"
          placeholder="New column name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'Escape') setAdding(false);
          }}
          data-testid={testId ? `${testId}-new-name` : undefined}
        />
        <button className="btn small primary" onClick={submit} type="button" data-testid={testId ? `${testId}-new-ok` : undefined}>Add</button>
      </span>
    );
  }
  return (
    <select
      value={value || ''}
      onChange={(e) => (e.target.value === '__new__' ? setAdding(true) : onChange(e.target.value || null))}
      data-testid={testId}
    >
      {allowNone && <option value="">— not exported —</option>}
      {project.columns
        .filter((c) => !excludeUrl || c.key !== project.urlColumnKey)
        .map((c) => (
          <option key={c.key} value={c.key}>
            {c.name}{c.index == null ? ' (new)' : ''}
          </option>
        ))}
      <option value="__new__">+ New column…</option>
    </select>
  );
}

function FieldCard({ project, field, index, count, update, remove, move, addColumn }) {
  const kinds = KINDS[field.method] || KINDS.manual;
  const set = (patch) => update({ ...field, ...patch });
  const setMethod = (method) => {
    const allowed = KINDS[method].map((k) => k.value);
    const kind = allowed.includes(field.kind) ? field.kind : allowed[0];
    set({ method, kind, separator: kind === field.kind ? field.separator : defaultSeparator(kind) });
  };
  const setKind = (kind) => set({ kind, separator: defaultSeparator(kind), multiple: kind === 'list' ? true : field.multiple });
  const multipleRelevant = !(field.method === 'source') && !(field.method === 'manual' && field.kind !== 'list');

  return (
    <li className="field-card" data-testid="field-card">
      <div className="field-head">
        <input
          className="field-label grow"
          value={field.label}
          onChange={(e) => set({ label: e.target.value })}
          aria-label="Field name"
          data-testid="field-label"
        />
        <button className="icon-btn" disabled={index === 0} onClick={() => move(index, index - 1)} title="Move up">↑</button>
        <button className="icon-btn" disabled={index === count - 1} onClick={() => move(index, index + 1)} title="Move down">↓</button>
        <ConfirmButton className="icon-btn" confirmText="Remove field?" onConfirm={remove}>✕</ConfirmButton>
      </div>
      <div className="form-grid">
        <label>
          Capture method
          <select value={field.method} onChange={(e) => setMethod(e.target.value)} data-testid="field-method">
            {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        <label>
          Content type
          <select value={field.kind} onChange={(e) => setKind(e.target.value)} disabled={kinds.length < 2} data-testid="field-kind">
            {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label className="span2">
          {field.method === 'source' ? 'Spreadsheet column' : field.kind === 'image' ? 'Image URL column' : 'Destination column'}
          <ColumnSelect project={project} value={field.columnKey} onChange={(columnKey) => set({ columnKey })} onCreate={(n) => set({ columnKey: addColumn(n) })} testId="field-column" />
        </label>
        {field.kind === 'image' && (
          <label className="span2">
            Image type (file name suffix)
              <select value={imageRole(field)} onChange={(e) => set({ imageRole: e.target.value })} data-testid="field-image-role">
                <option value="main">Main image (name-main)</option>
                <option value="gallery">Gallery (name-1, name-2, …)</option>
              </select>
            </label>
        )}
        {field.method === 'visual' && field.kind === 'html' && (
          <label className="span2">
            Clicks on the page
            <select value={field.captureAs || 'items'} onChange={(e) => set({ captureAs: e.target.value })} data-testid="field-capture-mode">
              {CAPTURE_MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Join multiple values with
          <input
            value={encodeSeparator(field.separator)}
            onChange={(e) => set({ separator: decodeSeparator(e.target.value) })}
            placeholder="e.g. , or \n"
            data-testid="field-separator"
          />
        </label>
        <div className="checks">
          {multipleRelevant && (
            <label className="check">
              <input type="checkbox" checked={!!field.multiple} onChange={(e) => set({ multiple: e.target.checked })} data-testid="field-multiple" />
              Multiple values
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={!!field.required} onChange={(e) => set({ required: e.target.checked })} data-testid="field-required" />
            Required
          </label>
        </div>
      </div>
      {!field.columnKey && <p className="warn small">Not mapped to a column – this field will not be exported.</p>}
      {field.method === 'source' && <p className="muted small">Shows the value already in the spreadsheet. It is only written if you override it for a product.</p>}
    </li>
  );
}

export default function FieldsView({ ctx }) {
  const { project, products, currentIndex, updateProject, setProducts, setView, saver } = ctx;
  const [newColName, setNewColName] = useState('');
  const fields = project.fields || [];
  const product = products[currentIndex];

  const addColumn = (name) => {
    const existing = project.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.key;
    const col = newColumn(name);
    updateProject((p) => ({ ...p, columns: [...p.columns, col] }));
    return col.key;
  };

  const updateField = (i, f) => updateProject((p) => ({ ...p, fields: p.fields.map((x, j) => (j === i ? f : x)) }));
  const removeField = (i) => updateProject((p) => ({ ...p, fields: p.fields.filter((_, j) => j !== i) }));
  const moveField = (a, b) => updateProject((p) => ({ ...p, fields: moveItem(p.fields, a, b) }));
  const addField = () => updateProject((p) => ({ ...p, fields: [...p.fields, createField({ label: `Field ${p.fields.length + 1}` })] }));
  const addPreset = (label) => {
    if (!label) return;
    updateProject((p) => ({ ...p, fields: [...p.fields, createPresetField(label, p.columns, p.urlColumnKey)] }));
  };
  const addSuggested = () => updateProject((p) => ({ ...p, fields: [...p.fields, ...suggestFields(p.columns, p.urlColumnKey)] }));

  const renameColumn = (key, name) => updateProject((p) => ({ ...p, columns: p.columns.map((c) => (c.key === key ? { ...c, name } : c)) }));
  const removeColumn = (key) =>
    updateProject((p) => ({
      ...p,
      columns: p.columns.filter((c) => c.key !== key),
      fields: p.fields.map((f) => ({
        ...f,
        columnKey: f.columnKey === key ? null : f.columnKey,
      })),
    }));

  const changeUrlColumn = async (key) => {
    const col = project.columns.find((c) => c.key === key);
    if (!col || col.index == null) return;
    updateProject({ urlColumnKey: key });
    const list = products.map((p) => {
      const raw = (p.source && p.source[col.index]) || '';
      return { ...p, url: normalizeProductUrl(raw) || '', rawUrl: raw };
    });
    setProducts(list);
    list.forEach((p) => saver.schedule(`product:${p.rowIndex}`, { kind: 'product', value: p }));
  };

  // Columns that receive values from fields: used for combine-format settings and preview.
  const usage = useMemo(() => {
    const map = new Map();
    for (const f of fields) {
      const add = (k, label) => k && map.set(k, [...(map.get(k) || []), label]);
      add(f.columnKey, f.label);
    }
    return map;
  }, [fields]);

  const preview = useMemo(() => (product ? computeRow(project, product) : {}), [project, product]);

  const setFormat = (key, patch) =>
    updateProject((p) => ({
      ...p,
      columnFormats: { ...p.columnFormats, [key]: { ...defaultColumnFormat(), ...(p.columnFormats || {})[key], ...patch } },
    }));

  return (
    <div className="view fields-view">
      <CollapsibleCard id="fields-columns" title="Columns" summary={`${project.columns.length} columns`} testId="section-columns">
        <p className="muted small">Rename destination columns or add new ones. Original data in every column is preserved on export.</p>
        <label className="inline-label">
          Product URL column
          <select value={project.urlColumnKey || ''} onChange={(e) => changeUrlColumn(e.target.value)} data-testid="fields-url-column">
            {project.columns.filter((c) => c.index != null).map((c) => (
              <option key={c.key} value={c.key}>{c.name}</option>
            ))}
          </select>
        </label>
        <ul className="column-list">
          {project.columns.map((c) => (
            <li key={c.key} data-testid="column-item">
              <input value={c.name} onChange={(e) => renameColumn(c.key, e.target.value)} aria-label="Column name" data-testid="column-name" />
              <span className="muted small">
                {c.index == null ? 'new column' : c.originalName !== c.name ? `was "${c.originalName}"` : 'existing'}
                {usage.has(c.key) && ` · ← ${usage.get(c.key).join(', ')}`}
              </span>
              {c.index == null && <button className="icon-btn" title="Remove column" onClick={() => removeColumn(c.key)}>✕</button>}
            </li>
          ))}
        </ul>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (newColName.trim()) addColumn(newColName.trim());
            setNewColName('');
          }}
        >
          <input className="grow" placeholder="New column name" value={newColName} onChange={(e) => setNewColName(e.target.value)} data-testid="new-column-name" />
          <button className="btn small" type="submit" data-testid="add-column">Add column</button>
        </form>
      </CollapsibleCard>

      <CollapsibleCard
        id="fields-fields"
        title="Fields"
        summary={`${fields.length} fields: ${fields.map((f) => f.label).join(', ')}`}
        testId="section-fields"
        actions={
          <div className="row">
            {!fields.length && <button className="btn small" onClick={addSuggested}>Add suggested fields</button>}
            <select
              className="preset-select"
              value=""
              onChange={(e) => addPreset(e.target.value)}
              aria-label="Add a ready-made field"
              data-testid="add-preset"
            >
              <option value="">+ Ready-made field…</option>
              {PRESET_LABELS.map((l) => (
                <option key={l} value={l}>{l}</option>
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
          {fields.map((f, i) => (
            <FieldCard
              key={f.id}
              project={project}
              field={f}
              index={i}
              count={fields.length}
              update={(nf) => updateField(i, nf)}
              remove={() => removeField(i)}
              move={moveField}
              addColumn={addColumn}
            />
          ))}
        </ul>
      </CollapsibleCard>

      <ImageSettings project={project} products={products} updateProject={updateProject} />

      <CollapsibleCard id="fields-formatting" defaultCollapsed title="Cell formatting" summary={`${usage.size} columns receive values`} testId="section-formatting">
        <p className="muted small">
          How values are combined in each destination column. Preview uses the current product{product ? ` (row ${product.rowIndex + 1})` : ''}.
        </p>
        {[...usage.keys()].map((key) => {
          const col = project.columns.find((c) => c.key === key);
          if (!col) return null;
          const fmt = { ...defaultColumnFormat(), ...(project.columnFormats || {})[key] };
          const multi = usage.get(key).length > 1;
          return (
            <div className="format-row" key={key} data-testid="format-row">
              <div className="format-title">
                <strong>{col.name}</strong> <span className="muted small">← {usage.get(key).join(' + ')}</span>
              </div>
              <div className="form-grid">
                <label>
                  Combine as
                  <select value={fmt.mode} onChange={(e) => setFormat(key, { mode: e.target.value })} data-testid="format-mode">
                    <option value="join">Separated list (a, b, c)</option>
                    <option value="path">One path (a &gt; b &gt; c)</option>
                    {multi && <option value="prefix">Path per value of last field (a &gt; b1, a &gt; b2)</option>}
                  </select>
                </label>
                {fmt.mode !== 'path' && (
                  <label>
                    {multi ? 'Separator between fields' : 'Separator'}
                    <input value={encodeSeparator(fmt.separator)} onChange={(e) => setFormat(key, { separator: decodeSeparator(e.target.value) })} data-testid="format-separator" />
                  </label>
                )}
                {fmt.mode !== 'join' && (
                  <label>
                    Path separator
                    <input value={encodeSeparator(fmt.pathSeparator)} onChange={(e) => setFormat(key, { pathSeparator: decodeSeparator(e.target.value) })} data-testid="format-path-separator" />
                  </label>
                )}
              </div>
              <pre className="cell-preview" data-testid="format-preview">{(preview[key] && preview[key].value) || '(empty for current product)'}</pre>
            </div>
          );
        })}
        {!usage.size && <p className="muted">Map fields to columns to configure formatting.</p>}
      </CollapsibleCard>
      <div className="footer-actions">
        <button className="btn primary" onClick={() => setView('collect')} data-testid="go-collect">Start collecting →</button>
      </div>
    </div>
  );
}
