import { useState } from 'react';
import { METHODS, KINDS, imageRole, defaultSeparator, encodeSeparator, decodeSeparator } from '../../services/fieldService.js';
import { ConfirmButton } from './common.jsx';
import { CAPTURE_MODES } from './FieldEditors.jsx';

const NEW_COLUMN_OPTION = '__new__';

/** Column dropdown that also lets the user create a new column inline. */
export function ColumnSelect({ project, value, onChange, onCreate, allowNone = true, testId, excludeUrl = true }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  if (adding) {
    const submit = () => {
      const name = newName.trim();
      if (name) onCreate(name);
      setAdding(false);
      setNewName('');
    };
    const onKeyDown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
      if (event.key === 'Escape') setAdding(false);
    };
    return (
      <span className="row">
        <input
          autoFocus
          className="grow"
          placeholder="New column name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={onKeyDown}
          data-testid={testId ? `${testId}-new-name` : undefined}
        />
        <button className="btn small primary" onClick={submit} type="button" data-testid={testId ? `${testId}-new-ok` : undefined}>Add</button>
      </span>
    );
  }

  const onSelect = (event) => {
    const selected = event.target.value;
    if (selected === NEW_COLUMN_OPTION) setAdding(true);
    else onChange(selected || null);
  };
  const columns = project.columns.filter((column) => !excludeUrl || column.key !== project.urlColumnKey);

  return (
    <select value={value || ''} onChange={onSelect} data-testid={testId}>
      {allowNone && <option value="">— not exported —</option>}
      {columns.map((column) => (
        <option key={column.key} value={column.key}>
          {column.name}{column.index == null ? ' (new)' : ''}
        </option>
      ))}
      <option value={NEW_COLUMN_OPTION}>+ New column…</option>
    </select>
  );
}

function columnLabelFor(field) {
  if (field.method === 'source') return 'Spreadsheet column';
  if (field.kind === 'image') return 'Image URL column';
  return 'Destination column';
}

/** Settings of one field in the Fields tab. */
export default function FieldCard({ project, field, index, count, update, remove, move, addColumn }) {
  const kinds = KINDS[field.method] || KINDS.manual;
  const set = (changes) => update({ ...field, ...changes });

  // Changing the method may make the content type unavailable: fall back to the first allowed one.
  const setMethod = (method) => {
    const allowedKinds = KINDS[method].map((kind) => kind.value);
    const kind = allowedKinds.includes(field.kind) ? field.kind : allowedKinds[0];
    const separator = kind === field.kind ? field.separator : defaultSeparator(kind);
    set({ method, kind, separator });
  };
  const setKind = (kind) => {
    set({ kind, separator: defaultSeparator(kind), multiple: kind === 'list' ? true : field.multiple });
  };

  // "Multiple values" only matters for visual selection and manual lists.
  const showMultipleOption = field.method === 'visual' || (field.method === 'manual' && field.kind === 'list');

  return (
    <li className="field-card" data-testid="field-card">
      <div className="field-head">
        <input
          className="field-label grow"
          value={field.label}
          onChange={(event) => set({ label: event.target.value })}
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
          <select value={field.method} onChange={(event) => setMethod(event.target.value)} data-testid="field-method">
            {METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
          </select>
        </label>
        <label>
          Content type
          <select value={field.kind} onChange={(event) => setKind(event.target.value)} disabled={kinds.length < 2} data-testid="field-kind">
            {kinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
          </select>
        </label>
        <label className="span2">
          {columnLabelFor(field)}
          <ColumnSelect
            project={project}
            value={field.columnKey}
            onChange={(columnKey) => set({ columnKey })}
            onCreate={(name) => set({ columnKey: addColumn(name) })}
            testId="field-column"
          />
        </label>

        {field.kind === 'image' && (
          <label className="span2">
            Image type (file name suffix)
            <select value={imageRole(field)} onChange={(event) => set({ imageRole: event.target.value })} data-testid="field-image-role">
              <option value="main">Main image (name-main)</option>
              <option value="gallery">Gallery (name-1, name-2, …)</option>
            </select>
          </label>
        )}

        {field.method === 'visual' && field.kind === 'html' && (
          <label className="span2">
            Clicks on the page
            <select value={field.captureAs || 'items'} onChange={(event) => set({ captureAs: event.target.value })} data-testid="field-capture-mode">
              {CAPTURE_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>{mode.label}</option>
              ))}
            </select>
          </label>
        )}

        <label>
          Join multiple values with
          <input
            value={encodeSeparator(field.separator)}
            onChange={(event) => set({ separator: decodeSeparator(event.target.value) })}
            placeholder="e.g. , or \n"
            data-testid="field-separator"
          />
        </label>
        <div className="checks">
          {showMultipleOption && (
            <label className="check">
              <input type="checkbox" checked={!!field.multiple} onChange={(event) => set({ multiple: event.target.checked })} data-testid="field-multiple" />
              Multiple values
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={!!field.required} onChange={(event) => set({ required: event.target.checked })} data-testid="field-required" />
            Required
          </label>
        </div>
      </div>

      {!field.columnKey && <p className="warn small">Not mapped to a column – this field will not be exported.</p>}
      {field.method === 'source' && (
        <p className="muted small">Shows the value already in the spreadsheet. It is only written if you override it for a product.</p>
      )}
    </li>
  );
}
