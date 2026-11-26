import { uid } from '../utils/id.js';
import { combineSelections, renderSelection, htmlToText, sanitizeHtml } from './htmlService.js';

/*
 * Field model
 * -----------
 * field = {
 *   id, label,
 *   columnKey,              // destination column (project.columns[].key) or null
 *   method: 'source' | 'manual' | 'visual',
 *   kind:   'text' | 'list' | 'html' | 'image',
 *   multiple: boolean,      // several selections/values allowed
 *   separator: string,      // joins this field's own values
 *   required: boolean,
 * }
 *
 * Per-product data lives in product.data[field.id]:
 *   manual text/html : string
 *   manual list      : string (raw comma separated input)
 *   source           : string override, or undefined to keep the spreadsheet value
 *   visual text/html : [{ id, html, text, sourceTag, outputTag }]
 *   visual image     : [{ id, url }]
 *
 * Column formats (project.columnFormats[columnKey]):
 *   { mode: 'join',   separator }                    a, b, c
 *   { mode: 'path',   pathSeparator }                a > b > c
 *   { mode: 'prefix', separator, pathSeparator }     a > b > c1, a > b > c2
 */

export const EXCEL_CELL_LIMIT = 32767;

export const METHODS = [
  { value: 'manual', label: 'Manual input' },
  { value: 'visual', label: 'Visual selection' },
  { value: 'source', label: 'Existing spreadsheet data' },
];

export const KINDS = {
  manual: [
    { value: 'text', label: 'Text' },
    { value: 'list', label: 'Comma-separated list' },
    { value: 'html', label: 'HTML' },
  ],
  visual: [
    { value: 'text', label: 'Text' },
    { value: 'html', label: 'HTML' },
    { value: 'image', label: 'Image(s)' },
  ],
  source: [{ value: 'text', label: 'Text' }],
};

export function defaultSeparator(kind) {
  if (kind === 'html') return '\n';
  if (kind === 'text') return ' ';
  return ', ';
}

export function defaultColumnFormat() {
  return { mode: 'join', separator: ', ', pathSeparator: ' > ' };
}

/** Splits comma-separated input: trims, drops empties and exact duplicates. */
export function parseList(input, delimiter = ',') {
  if (Array.isArray(input)) return input.map((s) => String(s).trim()).filter(Boolean);
  if (input == null) return [];
  const out = [];
  for (const part of String(input).split(delimiter)) {
    const v = part.replace(/\s+/g, ' ').trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Decodes escape sequences users type in separator inputs (\n, \t). */
export function decodeSeparator(sep) {
  if (sep == null) return '';
  return String(sep).replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}
export function encodeSeparator(sep) {
  return String(sep ?? '').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

export function createField(partial = {}) {
  const kind = partial.kind || 'text';
  return {
    id: uid('f_'),
    label: 'New field',
    columnKey: null,
    method: 'manual',
    kind,
    multiple: kind === 'list' || kind === 'html',
    separator: defaultSeparator(kind),
    required: false,
    ...partial,
  };
}

const SUGGESTIONS = [
  { label: 'SKU', method: 'source', kind: 'text', multiple: false, match: /^(sku|product\s*code|item\s*code|article)/i },
  { label: 'Product title', method: 'visual', kind: 'text', multiple: false, required: true, match: /^(name|title|product\s*(name|title))$/i },
  { label: 'Main categories', method: 'manual', kind: 'list', multiple: true, match: /categor/i },
  { label: 'Subcategories', method: 'manual', kind: 'list', multiple: true, match: /categor/i },
  { label: 'Product intro', method: 'visual', kind: 'html', multiple: true, match: /^(product\s*)?intro(duction)?(\s*text)?$/i },
  { label: 'Short description', method: 'visual', kind: 'html', multiple: true, match: /short\s*desc/i, optional: true },
  { label: 'Product description', method: 'visual', kind: 'html', multiple: true, match: /^(description|product\s*description|desc|content|long\s*description)$/i },
  { label: 'Main image', method: 'visual', kind: 'image', imageRole: 'main', multiple: false, separator: ', ', match: /^(images?|main\s*image|featured\s*image|image\s*url)$/i },
  { label: 'Gallery images', method: 'visual', kind: 'image', imageRole: 'gallery', multiple: true, separator: ', ', match: /(gallery|images?)/i },
];

function presetField(s, usable) {
  const col = usable.find((c) => s.match.test(c.name));
  return createField({
    label: s.label,
    method: s.method,
    kind: s.kind,
    multiple: s.multiple,
    required: !!s.required,
    ...(s.imageRole ? { imageRole: s.imageRole } : {}),
    separator: s.separator ?? defaultSeparator(s.kind),
    columnKey: col ? col.key : null,
  });
}

/** Suggested starting fields, matched against the workbook's headers when possible (all editable). */
export function suggestFields(columns, urlColumnKey) {
  const usable = columns.filter((c) => c.key !== urlColumnKey);
  return SUGGESTIONS.filter((s) => !s.optional || usable.some((c) => s.match.test(c.name))).map((s) => presetField(s, usable));
}

/** Names of the ready-made fields that can be added from the Fields tab. */
export const PRESET_LABELS = SUGGESTIONS.map((s) => s.label);

/** One ready-made field (e.g. "Product intro"), mapped to a matching column when one exists. */
export function createPresetField(label, columns, urlColumnKey) {
  const s = SUGGESTIONS.find((x) => x.label === label);
  if (!s) return createField({ label });
  return presetField(s, columns.filter((c) => c.key !== urlColumnKey));
}

function nonEmpty(list) {
  return list.map((v) => (v == null ? '' : String(v))).filter((v) => v.trim() !== '');
}

/** Returns the original spreadsheet value of a column for a product. */
export function sourceValue(project, product, columnKey) {
  const col = project.columns.find((c) => c.key === columnKey);
  if (!col || col.index == null) return '';
  const v = product.source ? product.source[col.index] : '';
  return v == null ? '' : String(v);
}

/**
 * Values a field produces for a product.
 * Returns { values: string[], writes: boolean }.
 * `writes` is false when the field only mirrors the spreadsheet (nothing to change).
 */
export function fieldValues(project, field, product, plan) {
  const data = product.data ? product.data[field.id] : undefined;
  let values = [];
  let writes = true;

  if (field.method === 'source') {
    if (data != null) values = nonEmpty([data]);
    else {
      values = nonEmpty([sourceValue(project, product, field.columnKey)]);
      writes = false;
    }
  } else if (field.kind === 'image') {
    const imgs = Array.isArray(data) ? data.filter((i) => i && i.url) : [];
    const urlFor = (i) => {
      const entry = plan && plan.find((e) => e.fieldId === field.id && e.imageId === i.id);
      return entry && entry.publicUrl ? entry.publicUrl : i.url;
    };
    values = imgs.map(urlFor);
  } else if (field.method === 'visual') {
    const items = Array.isArray(data) ? data : [];
    if (field.kind === 'html') values = items.map(renderSelection).filter((h) => h.trim());
    else values = nonEmpty(items.map((i) => (i.text != null ? i.text : htmlToText(i.html))));
  } else if (field.kind === 'list') {
    values = parseList(data);
  } else if (field.kind === 'html') {
    values = nonEmpty([sanitizeHtml(data || '')]);
  } else {
    values = nonEmpty([typeof data === 'string' ? data.trim() : data]);
  }
  return { values, writes };
}

/** Text of one field as it will appear (its own values joined). */
export function fieldText(project, field, product) {
  return fieldValues(project, field, product).values.join(decodeSeparator(field.separator ?? defaultSeparator(field.kind)));
}

function formatColumn(format, parts) {
  const f = { ...defaultColumnFormat(), ...(format || {}) };
  const sep = decodeSeparator(f.separator);
  const pathSep = decodeSeparator(f.pathSeparator);
  const withValues = parts.filter((p) => p.values.length);
  if (!withValues.length) return '';
  if (f.mode === 'path') {
    return withValues.flatMap((p) => p.values).join(pathSep);
  }
  if (f.mode === 'prefix') {
    if (withValues.length === 1) return withValues[0].values.join(sep);
    const last = withValues[withValues.length - 1];
    const prefix = withValues.slice(0, -1).flatMap((p) => p.values).join(pathSep);
    return last.values.map((v) => `${prefix}${pathSep}${v}`).join(sep);
  }
  return withValues.map((p) => p.values.join(p.separator)).join(sep);
}

/**
 * Computes the output cells for one product.
 * Returns { [columnKey]: { value, write, parts: [{ fieldId, label, values }] } }.
 * Fields sharing a column are combined in field order using the column format;
 * nothing is overwritten by another field.
 */
export function computeRow(project, product, plan) {
  if (plan === undefined) plan = imageSettings(project).baseUrl ? planProductImages(project, product) : null;
  const parts = {};
  const add = (key, part) => {
    if (!key) return;
    (parts[key] ||= []).push(part);
  };
  for (const field of project.fields || []) {
    const { values, writes } = fieldValues(project, field, product, plan);
    const separator = decodeSeparator(field.separator ?? defaultSeparator(field.kind));
    add(field.columnKey, { fieldId: field.id, label: field.label, values, writes, separator });
  }
  const out = {};
  for (const [key, list] of Object.entries(parts)) {
    const write = list.some((p) => p.writes);
    const value = formatColumn(project.columnFormats ? project.columnFormats[key] : null, list);
    out[key] = { value, write, parts: list };
  }
  return out;
}

export function missingRequired(project, product) {
  return (project.fields || [])
    .filter((f) => f.required)
    .filter((f) => !fieldValues(project, f, product).values.length)
    .map((f) => f.label);
}

/** Columns whose combined value exceeds Excel's per-cell character limit. */
export function oversizedCells(project, product) {
  const row = computeRow(project, product);
  return Object.entries(row)
    .filter(([, c]) => c.value.length > EXCEL_CELL_LIMIT)
    .map(([key]) => columnName(project, key));
}

export function columnName(project, key) {
  const c = (project.columns || []).find((x) => x.key === key);
  return c ? c.name : '(unassigned)';
}

export { combineSelections };

// ---------------------------------------------------------------------------
// Image file naming and public URLs
// ---------------------------------------------------------------------------

export const IMAGE_FORMATS = [
  { value: 'jpg', label: 'JPG', mime: 'image/jpeg' },
  { value: 'webp', label: 'WebP', mime: 'image/webp' },
  { value: 'png', label: 'PNG', mime: 'image/png' },
  { value: 'original', label: 'Keep original file (no resizing)', mime: null },
];

export function defaultImageSettings() {
  return {
    nameColumnKey: undefined, // column naming the files (e.g. SKU); undefined = auto-detect, '' = none
    lowercase: false,
    baseUrl: '', // e.g. https://www.example.com/images/ – empty keeps the original image URLs
    format: 'jpg',
    maxWidth: 1200,
    maxHeight: 1200,
    quality: 85,
    downloadZip: false,
  };
}

/**
 * Column used to identify products in the Collect tab's product list.
 * project.labelColumnKey: undefined/null = automatic (a SKU-like column, else a
 * name/title column, else the first non-URL column), '' = none (URL / row only).
 */
export function labelColumn(project) {
  const cols = ((project && project.columns) || []).filter((c) => c.index != null && c.key !== project.urlColumnKey);
  const key = project && project.labelColumnKey;
  if (key === '') return null;
  const chosen = key != null ? cols.find((c) => c.key === key) : null;
  if (chosen) return chosen; // a column that no longer exists falls back to automatic
  return (
    cols.find((c) => /^(sku|article|item\s*(no|code)|product\s*code|code)\b/i.test(c.name)) ||
    cols.find((c) => /^(product\s*)?(name|title)$/i.test(c.name)) ||
    cols[0] ||
    null
  );
}

/** Short text identifying a product (value of the identifier column, else its URL, else its row). */
export function productLabel(project, product) {
  const col = labelColumn(project);
  const v = col && product.source ? product.source[col.index] : null;
  if (v != null && String(v).trim()) return String(v).trim();
  return product.url || `Row ${product.rowIndex + 1}`;
}

export function imageSettings(project) {
  const st = { ...defaultImageSettings(), ...((project && project.imageSettings) || {}) };
  if (st.nameColumnKey === undefined || st.nameColumnKey === null) {
    const cols = (project && project.columns) || [];
    const guess = cols.find((c) => /^(sku|article|item\s*(no|code)|product\s*code|code)\b/i.test(c.name));
    st.nameColumnKey = guess ? guess.key : '';
  }
  return st;
}

export function imageRole(field) {
  return field.imageRole || (field.multiple ? 'gallery' : 'main');
}

/** Makes a value safe as a file name: letters, digits, dot, dash and underscore. */
export function sanitizeFileName(value, lowercase = false) {
  let s = String(value ?? '').trim()
    .normalize('NFKC')
    .replace(/\.[a-z0-9]{2,4}$/i, (m) => (/^\.(jpe?g|png|webp|gif|avif|svg)$/i.test(m) ? '' : m))
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (lowercase) s = s.toLowerCase();
  return s.slice(0, 120);
}

/** Value of a column for a product: what a (non-image) field writes there, else the spreadsheet value. */
function columnText(project, product, columnKey) {
  const fields = (project.fields || []).filter((f) => f.columnKey === columnKey && f.kind !== 'image');
  for (const f of fields) {
    const { values } = fieldValues(project, f, product);
    if (values.length) return values.join(' ');
  }
  return sourceValue(project, product, columnKey);
}

/** Automatic base name (from the configured column), ignoring the per-product override. */
export function autoImageBaseName(project, product) {
  const st = imageSettings(project);
  const raw = st.nameColumnKey ? columnText(project, product, st.nameColumnKey) : '';
  return sanitizeFileName(raw, st.lowercase) || `product-${product.rowIndex + 1}`;
}

export function imageBaseName(project, product) {
  const st = imageSettings(project);
  const own = sanitizeFileName(product.imageName, st.lowercase);
  return own || autoImageBaseName(project, product);
}

export function imageExtension(format, sourceUrl) {
  if (format && format !== 'original') return format;
  let path = '';
  try {
    path = new URL(sourceUrl).pathname;
  } catch {
    path = String(sourceUrl || '');
  }
  const m = /\.(jpe?g|png|webp|gif|avif|svg)$/i.exec(path);
  if (!m) return 'jpg';
  const ext = m[1].toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

export function publicImageUrl(baseUrl, fileName) {
  const base = String(baseUrl || '').trim();
  if (!base) return '';
  return `${base.endsWith('/') ? base : `${base}/`}${encodeURIComponent(fileName)}`;
}

/**
 * File names for every image of a product, in field order.
 * Main images: <name>-main.<ext> (further ones <name>-main-2 …); gallery images: <name>-1, <name>-2 …
 */
export function planProductImages(project, product) {
  const st = imageSettings(project);
  const base = imageBaseName(project, product);
  const out = [];
  let mainCount = 0;
  let galleryCount = 0;
  for (const field of project.fields || []) {
    if (field.kind !== 'image' || field.method !== 'visual') continue;
    const data = product.data ? product.data[field.id] : undefined;
    const imgs = Array.isArray(data) ? data.filter((i) => i && i.url) : [];
    const role = imageRole(field);
    for (const img of imgs) {
      let suffix;
      if (role === 'main') {
        mainCount++;
        suffix = mainCount === 1 ? 'main' : `main-${mainCount}`;
      } else {
        galleryCount++;
        suffix = String(galleryCount);
      }
      const fileName = `${base}-${suffix}.${imageExtension(st.format, img.url)}`;
      out.push({
        rowIndex: product.rowIndex,
        fieldId: field.id,
        fieldLabel: field.label,
        imageId: img.id,
        role,
        sourceUrl: img.url,
        fileName,
        publicUrl: publicImageUrl(st.baseUrl, fileName),
      });
    }
  }
  return out;
}

/**
 * Plans images for many products and makes file names unique: when two
 * different images would get the same name, later ones get "-row<N>" added.
 * Returns { plans: Map(rowIndex → entries), duplicates: [{ fileName, rows }] }.
 */
export function planAllImages(project, products) {
  const st = imageSettings(project);
  const used = new Map(); // fileName(lowercase) → { sourceUrl, rows }
  const plans = new Map();
  const duplicates = new Map();
  for (const product of products) {
    const entries = planProductImages(project, product).map((e) => {
      const key = e.fileName.toLowerCase();
      const prev = used.get(key);
      if (!prev) {
        used.set(key, { sourceUrl: e.sourceUrl, rows: [e.rowIndex] });
        return e;
      }
      if (prev.sourceUrl === e.sourceUrl) return e; // same picture, same file
      prev.rows.push(e.rowIndex);
      duplicates.set(e.fileName, prev.rows);
      const dot = e.fileName.lastIndexOf('.');
      const fileName = `${e.fileName.slice(0, dot)}-row${e.rowIndex + 1}${e.fileName.slice(dot)}`;
      used.set(fileName.toLowerCase(), { sourceUrl: e.sourceUrl, rows: [e.rowIndex] });
      return { ...e, fileName, publicUrl: publicImageUrl(st.baseUrl, fileName) };
    });
    plans.set(product.rowIndex, entries);
  }
  return { plans, duplicates: [...duplicates].map(([fileName, rows]) => ({ fileName, rows: [...new Set(rows)] })) };
}
