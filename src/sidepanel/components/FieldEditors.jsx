import { useState } from 'react';
import { parseList, sourceValue, decodeSeparator, defaultSeparator } from '../../services/fieldService.js';
import { OUTPUT_TAG_OPTIONS, moveItem, renderSelection, combineSelections, applyHtmlEdit, rootTag, sanitizeHtml, mergeIntoList } from '../../services/htmlService.js';
import { uid } from '../../utils/id.js';
import HtmlPreview from './HtmlPreview.jsx';

/*
 * Editors for one field of the current product in the Collect tab. Which
 * editor is used depends on the field's method and kind (see FieldEditor at
 * the bottom).
 */

const METHOD_LABELS = { source: 'spreadsheet', manual: 'manual', visual: 'visual' };

/** The frame around every field editor: title, method, buttons. */
function FieldShell({ field, children, actions, testId }) {
  return (
    <div className="field-editor" data-testid={testId || 'field-editor'} data-field-id={field.id} data-field-label={field.label}>
      <div className="field-editor-head">
        <span className="field-title">
          {field.label}
          {field.required && <span className="req" title="Required">*</span>}
        </span>
        <span className="field-meta">{METHOD_LABELS[field.method] || 'visual'} · {field.kind}</span>
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
          onChange={(event) => onChange(event.target.value)}
          placeholder="Comma-separated, e.g. Electronics, Television"
          data-testid="manual-input"
        />
        {items.length > 0 && (
          <div className="chips" data-testid="list-chips">
            {items.map((item) => (
              <span className="chip" key={item}>
                {item}
                <button
                  className="chip-x"
                  title="Remove"
                  onClick={() => onChange(items.filter((other) => other !== item).join(', '))}
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
        <textarea rows={4} value={value || ''} onChange={(event) => onChange(event.target.value)} placeholder="<p>…</p>" data-testid="manual-input" />
        {value && <HtmlPreview html={sanitizeHtml(value)} />}
      </FieldShell>
    );
  }
  return (
    <FieldShell field={field}>
      <input value={value || ''} onChange={(event) => onChange(event.target.value)} data-testid="manual-input" />
    </FieldShell>
  );
}

/** Shows the spreadsheet value; "Edit" creates an override for this product, "Reset" removes it. */
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
        <input value={value} onChange={(event) => onChange(event.target.value)} data-testid="source-input" />
      ) : (
        <div className="source-value" data-testid="source-value">{original || <span className="muted">(empty in spreadsheet)</span>}</div>
      )}
    </FieldShell>
  );
}

function SelectButton({ field, selecting, onToggle }) {
  const active = selecting === field.id;
  let text = field.kind === 'image' ? 'Select image' : 'Select on page';
  if (active) text = '■ Stop selecting';
  return (
    <button className={`btn small ${active ? 'selecting' : 'primary'}`} onClick={() => onToggle(field)} data-testid="select-toggle">
      {text}
    </button>
  );
}

/** Text of an option in the output tag dropdown. */
function outputTagLabel(tag, html) {
  if (tag === 'unwrap') return 'remove wrapper';
  if (tag !== 'keep') return `<${tag}>`;
  const currentTag = rootTag(html);
  return currentTag ? `keep <${currentTag}>` : 'keep as is';
}

/** One captured element in the list: tick box, output tag, move/edit/remove buttons. */
function SelectionItem({ field, item, index, count, onChange, onMove, onRemove, checked, onCheck }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(''); // HTML being typed; applied when the textarea loses focus
  const isHtml = field.kind === 'html';
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
            onChange={(event) => onCheck(event.target.checked)}
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
            <select value={item.outputTag || 'keep'} onChange={(event) => onChange({ ...item, outputTag: event.target.value })} data-testid="output-tag">
              {OUTPUT_TAG_OPTIONS.map((tag) => (
                <option key={tag} value={tag}>{outputTagLabel(tag, item.html)}</option>
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
      {editing && isHtml && (
        <textarea
          rows={5}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onChange(applyHtmlEdit(item, draft))}
          data-testid="sel-edit"
        />
      )}
      {editing && !isHtml && (
        <textarea rows={2} value={item.text} onChange={(event) => onChange({ ...item, text: event.target.value })} data-testid="sel-edit" />
      )}
      {!editing && (
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

/** Text or HTML captured by clicking elements on the page. */
export function VisualField({ field, value, onChange, selecting, onToggleSelect, onFieldChange }) {
  const items = Array.isArray(value) ? value : [];
  const [checkedIds, setCheckedIds] = useState(() => new Set());
  const setItems = (list) => onChange(list);
  const separator = decodeSeparator(field.separator ?? defaultSeparator(field.kind));
  const isHtml = field.kind === 'html';
  const checkedItems = items.filter((item) => checkedIds.has(item.id));

  const setChecked = (itemId, isChecked) =>
    setCheckedIds((previous) => {
      const next = new Set(previous);
      if (isChecked) next.add(itemId);
      else next.delete(itemId);
      return next;
    });

  /** Merges the ticked items into one list, placed where the first ticked item was. */
  const makeList = (tag) => {
    if (!checkedItems.length) return;
    const mergedList = mergeIntoList(checkedItems, tag, uid('s_'));
    const result = [];
    let mergedListAdded = false;
    for (const item of items) {
      if (!checkedIds.has(item.id)) {
        result.push(item);
      } else if (!mergedListAdded) {
        result.push(mergedList);
        mergedListAdded = true;
      }
    }
    setItems(result);
    setCheckedIds(new Set());
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
          <select value={field.captureAs || 'items'} onChange={(event) => onFieldChange({ captureAs: event.target.value })} data-testid="capture-mode">
            {CAPTURE_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>{mode.label}</option>
            ))}
          </select>
        </label>
      )}
      {!items.length && (
        <p className="muted small">
          {selecting === field.id ? 'Click elements on the page…' : `No ${field.multiple ? 'elements' : 'element'} selected yet.`}
        </p>
      )}
      {isHtml && checkedItems.length > 0 && (
        <div className="list-bar" data-testid="list-bar">
          <span className="small">{checkedItems.length} ticked:</span>
          <button className="btn small" onClick={() => makeList('ul')} data-testid="make-ul">Make bullet list</button>
          <button className="btn small" onClick={() => makeList('ol')} data-testid="make-ol">Make numbered list</button>
          <button className="link-btn small" onClick={() => setCheckedIds(new Set())}>Untick</button>
        </div>
      )}
      {items.length > 0 && (
        <ol className="selection-list">
          {items.map((item, index) => (
            <SelectionItem
              key={item.id}
              field={field}
              item={item}
              index={index}
              count={items.length}
              checked={checkedIds.has(item.id)}
              onCheck={(isChecked) => setChecked(item.id, isChecked)}
              onChange={(changed) => setItems(items.map((other) => (other.id === item.id ? changed : other)))}
              onMove={(from, to) => setItems(moveItem(items, from, to))}
              onRemove={() => setItems(items.filter((other) => other.id !== item.id))}
            />
          ))}
        </ol>
      )}
      {isHtml && items.length > 0 && <HtmlPreview html={combineSelections(items, separator)} />}
    </FieldShell>
  );
}

/** Images captured on the page or pasted as URLs. */
export function ImageField({ field, value, onChange, selecting, onToggleSelect }) {
  const images = Array.isArray(value) ? value : [];
  const [pastedUrl, setPastedUrl] = useState('');
  const updateImage = (imageId, changes) =>
    onChange(images.map((image) => (image.id === imageId ? { ...image, ...changes } : image)));
  const addPastedUrl = (event) => {
    event.preventDefault();
    const url = pastedUrl.trim();
    if (!/^https?:\/\//i.test(url)) return;
    const image = { id: uid('i_'), url };
    onChange(field.multiple ? [...images, image] : [image]);
    setPastedUrl('');
  };
  return (
    <FieldShell
      field={field}
      testId="image-field"
      actions={
        <>
          {images.length > 0 && <button className="btn small" onClick={() => onChange([])} data-testid="sel-clear">Clear</button>}
          <SelectButton field={field} selecting={selecting} onToggle={onToggleSelect} />
        </>
      }
    >
      {images.length > 0 && (
        <ol className="image-list">
          {images.map((image, index) => (
            <li key={image.id} className="image-item" data-testid="image-item">
              <img src={image.url} alt="" referrerPolicy="no-referrer" />
              <div className="image-meta">
                <input value={image.url} onChange={(event) => updateImage(image.id, { url: event.target.value })} aria-label="Image URL" data-testid="image-url" />
              </div>
              <div className="image-actions">
                <button className="icon-btn" disabled={index === 0} onClick={() => onChange(moveItem(images, index, index - 1))} title="Move up">↑</button>
                <button className="icon-btn" disabled={index === images.length - 1} onClick={() => onChange(moveItem(images, index, index + 1))} title="Move down">↓</button>
                <button className="icon-btn" onClick={() => onChange(images.filter((other) => other.id !== image.id))} title="Remove" data-testid="image-remove">✕</button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <form className="row" onSubmit={addPastedUrl}>
        <input className="grow" value={pastedUrl} onChange={(event) => setPastedUrl(event.target.value)} placeholder="…or paste an image URL" />
        <button className="btn small" type="submit">Add</button>
      </form>
    </FieldShell>
  );
}

/** Picks the right editor for a field. */
export function FieldEditor({ project, field, product, onChange, selecting, onToggleSelect, onFieldChange }) {
  const value = product.data ? product.data[field.id] : undefined;

  if (field.method === 'source') {
    return <SourceField project={project} field={field} product={product} value={value} onChange={onChange} />;
  }
  if (field.method === 'manual') {
    return <ManualField field={field} value={value} onChange={onChange} />;
  }
  if (field.kind === 'image') {
    return <ImageField field={field} value={value} onChange={onChange} selecting={selecting} onToggleSelect={onToggleSelect} />;
  }
  return (
    <VisualField
      field={field}
      value={value}
      onChange={onChange}
      selecting={selecting}
      onToggleSelect={onToggleSelect}
      onFieldChange={onFieldChange}
    />
  );
}
