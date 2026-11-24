import { useState } from 'react';
import { parseList, sourceValue, fieldValues, decodeSeparator, defaultSeparator } from '../../services/fieldService.js';
import { OUTPUT_TAG_OPTIONS, moveItem, renderSelection, combineSelections, applyHtmlEdit, rootTag, sanitizeHtml, mergeIntoList } from '../../services/htmlService.js';
import { uid } from '../../utils/id.js';
import HtmlPreview from './HtmlPreview.jsx';

function FieldShell({ field, children, actions, testId }) {
  return (
    <div className="field-editor" data-testid={testId || 'field-editor'} data-field-id={field.id} data-field-label={field.label}>
      <div className="field-editor-head">
        <span className="field-title">
          {field.label}
          {field.required && <span className="req" title="Required">*</span>}
        </span>
        <span className="field-meta">{field.method === 'source' ? 'spreadsheet' : field.method === 'manual' ? 'manual' : 'visual'} · {field.kind}</span>
        <span className="grow" />
        {actions}
      </div>
      {children}
    </div>
  );
}

export function ManualField({ field, value, onChange }) {
  if (field.kind === 'list') {
    const items = parseList(value);
    return (
      <FieldShell field={field}>
        <input
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Comma-separated, e.g. Electronics, Television"
          data-testid="manual-input"
        />
        {items.length > 0 && (
          <div className="chips" data-testid="list-chips">
            {items.map((v) => (
              <span className="chip" key={v}>
                {v}
                <button
                  className="chip-x"
                  title="Remove"
                  onClick={() => onChange(items.filter((x) => x !== v).join(', '))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </FieldShell>
    );
  }
  if (field.kind === 'html') {
    return (
      <FieldShell field={field}>
        <textarea rows={4} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="<p>…</p>" data-testid="manual-input" />
        {value && <HtmlPreview html={sanitizeHtml(value)} />}
      </FieldShell>
    );
  }
  return (
    <FieldShell field={field}>
      <input value={value || ''} onChange={(e) => onChange(e.target.value)} data-testid="manual-input" />
    </FieldShell>
  );
}

export function SourceField({ project, field, product, value, onChange }) {
  const original = sourceValue(project, product, field.columnKey);
  const overridden = value != null;
  return (
    <FieldShell
      field={field}
      actions={
        overridden ? (
          <button className="btn small" onClick={() => onChange(undefined)} title="Use the spreadsheet value again">Reset</button>
        ) : (
          <button className="btn small" onClick={() => onChange(original)} data-testid="source-edit">Edit</button>
        )
      }
    >
      {overridden ? (
        <input value={value} onChange={(e) => onChange(e.target.value)} data-testid="source-input" />
      ) : (
        <div className="source-value" data-testid="source-value">{original || <span className="muted">(empty in spreadsheet)</span>}</div>
      )}
    </FieldShell>
  );
}

function SelectButton({ field, selecting, onToggle }) {
  const active = selecting === field.id;
  return (
    <button className={`btn small ${active ? 'selecting' : 'primary'}`} onClick={() => onToggle(field)} data-testid="select-toggle">
      {active ? '■ Stop selecting' : field.kind === 'image' ? 'Select image' : 'Select on page'}
    </button>
  );
}

function SelectionItem({ field, item, index, count, onChange, onMove, onRemove, checked, onCheck }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const isHtml = field.kind === 'html';
  const keepLabel = isHtml ? (rootTag(item.html) ? `keep <${rootTag(item.html)}>` : 'keep as is') : '';
  const toggleEdit = () => {
    // HTML items are edited as their final output, so what you type is what gets exported.
    if (!editing && isHtml) setDraft(renderSelection(item));
    setEditing(!editing);
  };
  return (
    <li className="selection-item" data-testid="selection-item">
      <div className="selection-head">
        {isHtml && (
          <input
            type="checkbox"
            className="sel-check"
            checked={!!checked}
            onChange={(e) => onCheck(e.target.checked)}
            title="Tick items to combine them into one list"
            aria-label={`Select item ${index + 1}`}
            data-testid="sel-check"
          />
        )}
        <span className="badge">{index + 1}</span>
        <span className="tag-from" title="Original element">&lt;{item.sourceTag}&gt;</span>
        {isHtml && (
          <label className="tag-select">
            →
            <select value={item.outputTag || 'keep'} onChange={(e) => onChange({ ...item, outputTag: e.target.value })} data-testid="output-tag">
              {OUTPUT_TAG_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t === 'keep' ? keepLabel : t === 'unwrap' ? 'remove wrapper' : `<${t}>`}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="grow" />
        <button className="icon-btn" disabled={index === 0} onClick={() => onMove(index, index - 1)} title="Move up" data-testid="sel-up">↑</button>
        <button className="icon-btn" disabled={index === count - 1} onClick={() => onMove(index, index + 1)} title="Move down" data-testid="sel-down">↓</button>
        <button className="icon-btn" onClick={toggleEdit} title="Edit" data-testid="sel-edit-toggle">✎</button>
        <button className="icon-btn" onClick={onRemove} title="Remove" data-testid="sel-remove">✕</button>
      </div>
      {editing ? (
        isHtml ? (
          <textarea
            rows={5}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => onChange(applyHtmlEdit(item, draft))}
            data-testid="sel-edit"
          />
        ) : (
          <textarea rows={2} value={item.text} onChange={(e) => onChange({ ...item, text: e.target.value })} data-testid="sel-edit" />
        )
      ) : (
        <div className="selection-text">{isHtml ? <code>{renderSelection(item).slice(0, 220)}</code> : item.text}</div>
      )}
    </li>
  );
}

export const CAPTURE_MODES = [
  { value: 'items', label: 'Each click = separate item' },
  { value: 'ul', label: 'Clicks build one bullet list (ul)' },
  { value: 'ol', label: 'Clicks build one numbered list (ol)' },
];

export function VisualField({ field, value, onChange, selecting, onToggleSelect, onFieldChange }) {
  const items = Array.isArray(value) ? value : [];
  const [checked, setChecked] = useState(() => new Set());
  const setItems = (list) => onChange(list);
  const sep = decodeSeparator(field.separator ?? defaultSeparator(field.kind));
  const isHtml = field.kind === 'html';
  const picked = items.filter((i) => checked.has(i.id));

  const makeList = (tag) => {
    if (!picked.length) return;
    // The new list takes the place of the first ticked item; the others are merged into it.
    const merged = mergeIntoList(picked, tag, uid('s_'));
    const firstIndex = items.findIndex((i) => checked.has(i.id));
    const rest = items.filter((i) => !checked.has(i.id));
    const before = items.slice(0, firstIndex).filter((i) => !checked.has(i.id)).length;
    setItems([...rest.slice(0, before), merged, ...rest.slice(before)]);
    setChecked(new Set());
  };

  return (
    <FieldShell
      field={field}
      actions={
        <>
          {items.length > 0 && (
            <button className="btn small" onClick={() => setItems([])} data-testid="sel-clear">Clear</button>
          )}
          <SelectButton field={field} selecting={selecting} onToggle={onToggleSelect} />
        </>
      }
    >
      {isHtml && onFieldChange && (
        <label className="capture-mode">
          <span className="muted small">Clicks on the page:</span>
          <select value={field.captureAs || 'items'} onChange={(e) => onFieldChange({ captureAs: e.target.value })} data-testid="capture-mode">
            {CAPTURE_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </label>
      )}
      {!items.length && (
        <p className="muted small">
          {selecting === field.id ? 'Click elements on the page…' : `No ${field.multiple ? 'elements' : 'element'} selected yet.`}
        </p>
      )}
      {isHtml && picked.length > 0 && (
        <div className="list-bar" data-testid="list-bar">
          <span className="small">{picked.length} ticked:</span>
          <button className="btn small" onClick={() => makeList('ul')} data-testid="make-ul">Make bullet list</button>
          <button className="btn small" onClick={() => makeList('ol')} data-testid="make-ol">Make numbered list</button>
          <button className="link-btn small" onClick={() => setChecked(new Set())}>Untick</button>
        </div>
      )}
      {items.length > 0 && (
        <ol className="selection-list">
          {items.map((it, i) => (
            <SelectionItem
              key={it.id}
              field={field}
              item={it}
              index={i}
              count={items.length}
              checked={checked.has(it.id)}
              onCheck={(on) =>
                setChecked((prev) => {
                  const next = new Set(prev);
                  if (on) next.add(it.id);
                  else next.delete(it.id);
                  return next;
                })
              }
              onChange={(n) => setItems(items.map((x) => (x.id === it.id ? n : x)))}
              onMove={(a, b) => setItems(moveItem(items, a, b))}
              onRemove={() => setItems(items.filter((x) => x.id !== it.id))}
            />
          ))}
        </ol>
      )}
      {isHtml && items.length > 0 && <HtmlPreview html={combineSelections(items, sep)} />}
    </FieldShell>
  );
}

export function ImageField({ field, value, onChange, selecting, onToggleSelect }) {
  const items = Array.isArray(value) ? value : [];
  const [url, setUrl] = useState('');
  const update = (id, patch) => onChange(items.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const addManual = (e) => {
    e.preventDefault();
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) return;
    const item = { id: uid('i_'), url: u };
    onChange(field.multiple ? [...items, item] : [item]);
    setUrl('');
  };
  return (
    <FieldShell
      field={field}
      testId="image-field"
      actions={
        <>
          {items.length > 0 && <button className="btn small" onClick={() => onChange([])} data-testid="sel-clear">Clear</button>}
          <SelectButton field={field} selecting={selecting} onToggle={onToggleSelect} />
        </>
      }
    >
      {items.length > 0 && (
        <ol className="image-list">
          {items.map((img, i) => (
            <li key={img.id} className="image-item" data-testid="image-item">
              <img src={img.url} alt="" referrerPolicy="no-referrer" />
              <div className="image-meta">
                <input value={img.url} onChange={(e) => update(img.id, { url: e.target.value })} aria-label="Image URL" data-testid="image-url" />
              </div>
              <div className="image-actions">
                <button className="icon-btn" disabled={i === 0} onClick={() => onChange(moveItem(items, i, i - 1))} title="Move up">↑</button>
                <button className="icon-btn" disabled={i === items.length - 1} onClick={() => onChange(moveItem(items, i, i + 1))} title="Move down">↓</button>
                <button className="icon-btn" onClick={() => onChange(items.filter((x) => x.id !== img.id))} title="Remove" data-testid="image-remove">✕</button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <form className="row" onSubmit={addManual}>
        <input className="grow" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="…or paste an image URL" />
        <button className="btn small" type="submit">Add</button>
      </form>
    </FieldShell>
  );
}

export function FieldEditor({ project, field, product, onChange, selecting, onToggleSelect, onFieldChange }) {
  const value = product.data ? product.data[field.id] : undefined;
  if (field.method === 'source') return <SourceField project={project} field={field} product={product} value={value} onChange={onChange} />;
  if (field.method === 'manual') return <ManualField field={field} value={value} onChange={onChange} />;
  if (field.kind === 'image') return <ImageField field={field} value={value} onChange={onChange} selecting={selecting} onToggleSelect={onToggleSelect} />;
  return <VisualField field={field} value={value} onChange={onChange} selecting={selecting} onToggleSelect={onToggleSelect} onFieldChange={onFieldChange} />;
}

export { fieldValues };
