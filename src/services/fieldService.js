import { uid } from '../utils/id.js';
import { renderSelection, htmlToText, sanitizeHtml } from './htmlService.js';

/*
 * Field model
 * -----------
 * A "field" is one piece of product information the user collects, and the
 * column it is written to. It is stored in project.fields:
 *
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
 * What was collected for a product lives in product.data[field.id]:
 *   manual text/html : string
 *   manual list      : string (raw comma separated input)
 *   source           : string override, or undefined to keep the spreadsheet value
 *   visual text/html : [{ id, html, text, sourceTag, outputTag }]
 *   visual image     : [{ id, url }]
 *
 * When several fields write to the same column, the column format decides how
 * they are combined (project.columnFormats[columnKey]):
 *   { mode: 'join',   separator }                    a, b, c
 *   { mode: 'path',   pathSeparator }                a > b > c
 *   { mode: 'prefix', separator, pathSeparator }     a > b > c1, a > b > c2
 */

export const EXCEL_CELL_LIMIT = 32767;

/** Column names that look like a product code (used to pick sensible defaults). */
const SKU_COLUMN_PATTERN = /^(sku|article|item\s*(no|code)|product\s*code|code)\b/i;

export const METHODS = [
  { value: 'manual', label: 'Manual input' },
  { value: 'visual', label: 'Visual selection' },
  { value: 'source', label: 'Existing spreadsheet data' },
];

/** Which kinds of value each method supports. */
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
  if (Array.isArray(input)) {
    return input.map((item) => String(item).trim()).filter(Boolean);
  }
  if (input == null) return [];

  const result = [];
  for (const part of String(input).split(delimiter)) {
    const value = part.replace(/\s+/g, ' ').trim();
    if (value && !result.includes(value)) result.push(value);
  }
  return result;
}

/** Turns the escape sequences users type in separator inputs (\n, \t) into real characters. */
export function decodeSeparator(separator) {
  if (separator == null) return '';
  return String(separator).replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

/** The reverse of decodeSeparator: shows newlines and tabs as \n and \t in inputs. */
export function encodeSeparator(separator) {
  return String(separator ?? '').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

/** A new field with default settings; any property in `overrides` replaces the default. */
export function createField(overrides = {}) {
  const kind = overrides.kind || 'text';
  return {
    id: uid('f_'),
    label: 'New field',
    columnKey: null,
    method: 'manual',
    kind,
    multiple: kind === 'list' || kind === 'html',
    separator: defaultSeparator(kind),
    required: false,
    ...overrides,
  };
}

/*
 * Ready-made fields. `match` is tested against the workbook's column names to
 * map the field to a column automatically. Fields marked `optional` are only
 * suggested when such a column exists.
 */
const PRESETS = [
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

function fieldFromPreset(preset, availableColumns) {
  const matchingColumn = availableColumns.find((column) => preset.match.test(column.name));
  const settings = {
    label: preset.label,
    method: preset.method,
    kind: preset.kind,
    multiple: preset.multiple,
    required: !!preset.required,
    separator: preset.separator ?? defaultSeparator(preset.kind),
    columnKey: matchingColumn ? matchingColumn.key : null,
  };
  if (preset.imageRole) settings.imageRole = preset.imageRole;
  return createField(settings);
}

/** Suggested starting fields, matched against the workbook's headers when possible (all editable). */
export function suggestFields(columns, urlColumnKey) {
  const availableColumns = columns.filter((column) => column.key !== urlColumnKey);
  const hasMatchingColumn = (preset) => availableColumns.some((column) => preset.match.test(column.name));

  return PRESETS
    .filter((preset) => !preset.optional || hasMatchingColumn(preset))
    .map((preset) => fieldFromPreset(preset, availableColumns));
}

/** Names of the ready-made fields that can be added from the Fields tab. */
export const PRESET_LABELS = PRESETS.map((preset) => preset.label);

/** One ready-made field (e.g. "Product intro"), mapped to a matching column when one exists. */
export function createPresetField(label, columns, urlColumnKey) {
  const preset = PRESETS.find((candidate) => candidate.label === label);
  if (!preset) return createField({ label });
  const availableColumns = columns.filter((column) => column.key !== urlColumnKey);
  return fieldFromPreset(preset, availableColumns);
}

/** Converts values to strings and drops empty ones. */
function nonEmptyStrings(values) {
  return values
    .map((value) => (value == null ? '' : String(value)))
    .filter((value) => value.trim() !== '');
}

/** The column with this key, or undefined. */
export function findColumn(project, columnKey) {
  return (project.columns || []).find((column) => column.key === columnKey);
}

/** Returns the original spreadsheet value of a column for a product. */
export function sourceValue(project, product, columnKey) {
  const column = findColumn(project, columnKey);
  if (!column || column.index == null) return ''; // new columns have no original data
  const value = product.source ? product.source[column.index] : '';
  return value == null ? '' : String(value);
}

/**
 * Values a field produces for a product.
 * Returns { values: string[], writes: boolean }.
 * `writes` is false when the field only mirrors the spreadsheet (nothing to change).
 * `imagePlan` (optional) holds the new image URLs when images are moved to a new location.
 */
export function fieldValues(project, field, product, imagePlan) {
  const data = product.data ? product.data[field.id] : undefined;

  if (field.method === 'source') {
    // No override typed: show the spreadsheet value but leave the cell untouched.
    if (data == null) {
      return { values: nonEmptyStrings([sourceValue(project, product, field.columnKey)]), writes: false };
    }
    return { values: nonEmptyStrings([data]), writes: true };
  }

  if (field.kind === 'image') {
    const images = Array.isArray(data) ? data.filter((image) => image && image.url) : [];
    const urlForImage = (image) => {
      const planned = imagePlan && imagePlan.find((entry) => entry.fieldId === field.id && entry.imageId === image.id);
      return planned && planned.publicUrl ? planned.publicUrl : image.url;
    };
    return { values: images.map(urlForImage), writes: true };
  }

  if (field.method === 'visual') {
    const selections = Array.isArray(data) ? data : [];
    if (field.kind === 'html') {
      const htmlParts = selections.map(renderSelection).filter((html) => html.trim());
      return { values: htmlParts, writes: true };
    }
    const texts = selections.map((selection) => (selection.text != null ? selection.text : htmlToText(selection.html)));
    return { values: nonEmptyStrings(texts), writes: true };
  }

  // Manual input
  if (field.kind === 'list') return { values: parseList(data), writes: true };
  if (field.kind === 'html') return { values: nonEmptyStrings([sanitizeHtml(data || '')]), writes: true };
  const text = typeof data === 'string' ? data.trim() : data;
  return { values: nonEmptyStrings([text]), writes: true };
}

// ---------------------------------------------------------------------------
// Copying collected data from one product to another (similar variants)
// ---------------------------------------------------------------------------

/**
 * Fields whose data can be copied between products: manual input and visual
 * selection. "Existing spreadsheet data" fields always stay with their own row.
 */
export function copyableFields(project, { includeImages = false } = {}) {
  return (project.fields || []).filter((field) => {
    if (field.method === 'source') return false;
    if (field.kind === 'image' && !includeImages) return false;
    return true;
  });
}

/** A copy of one field's value. Selections and images get new ids, so the two products never share items. */
function copyFieldValue(field, value) {
  if (!Array.isArray(value)) return value; // text, typed list or manual HTML
  const idPrefix = field.kind === 'image' ? 'i_' : 's_';
  return value.map((item) => ({ ...item, id: uid(idPrefix) }));
}

/**
 * The data of `toProduct` after copying the copyable fields from `fromProduct`.
 * Copied fields replace what was there (also when they are empty in
 * `fromProduct`); all other fields keep their value. The custom image file
 * name and the status are not part of `data`, so they are never copied.
 */
export function copyProductData(project, fromProduct, toProduct, options = {}) {
  const fromData = fromProduct.data || {};
  const result = { ...(toProduct.data || {}) };
  for (const field of copyableFields(project, options)) {
    if (fromData[field.id] === undefined) delete result[field.id];
    else result[field.id] = copyFieldValue(field, fromData[field.id]);
  }
  return result;
}

/** True when the product has a value in any field that copying would replace. */
export function hasCopyableData(project, product, options = {}) {
  return copyableFields(project, options).some((field) => fieldValues(project, field, product).values.length > 0);
}

/**
 * Combines the values of all fields that write to one column into the cell text.
 * Example with Main categories = [Electronics, Television] and
 * Subcategories = [Smart TVs, 4K TVs]:
 *   join   → "Electronics, Television, Smart TVs, 4K TVs"
 *   path   → "Electronics > Television > Smart TVs > 4K TVs"
 *   prefix → "Electronics > Television > Smart TVs, Electronics > Television > 4K TVs"
 */
function formatColumn(format, parts) {
  const settings = { ...defaultColumnFormat(), ...(format || {}) };
  const separator = decodeSeparator(settings.separator);
  const pathSeparator = decodeSeparator(settings.pathSeparator);
  const partsWithValues = parts.filter((part) => part.values.length);
  if (!partsWithValues.length) return '';

  if (settings.mode === 'path') {
    const allValues = partsWithValues.flatMap((part) => part.values);
    return allValues.join(pathSeparator);
  }

  if (settings.mode === 'prefix') {
    if (partsWithValues.length === 1) return partsWithValues[0].values.join(separator);
    // Every value of the last field gets the values of the earlier fields as a path in front.
    const lastPart = partsWithValues[partsWithValues.length - 1];
    const earlierValues = partsWithValues.slice(0, -1).flatMap((part) => part.values);
    const prefix = earlierValues.join(pathSeparator);
    return lastPart.values.map((value) => `${prefix}${pathSeparator}${value}`).join(separator);
  }

  // 'join': each field joins its own values with its own separator, then fields are joined.
  return partsWithValues.map((part) => part.values.join(part.separator)).join(separator);
}

/**
 * Computes the output cells for one product.
 * Returns { [columnKey]: { value, write, parts: [{ fieldId, label, values }] } }.
 * Fields sharing a column are combined in field order using the column format;
 * nothing is overwritten by another field.
 */
export function computeRow(project, product, imagePlan) {
  // Image URLs only change when a new image location (base URL) is set.
  if (imagePlan === undefined) {
    imagePlan = imageSettings(project).baseUrl ? planProductImages(project, product) : null;
  }

  // Group the fields' values by destination column.
  const partsByColumn = {};
  for (const field of project.fields || []) {
    if (!field.columnKey) continue;
    const { values, writes } = fieldValues(project, field, product, imagePlan);
    const separator = decodeSeparator(field.separator ?? defaultSeparator(field.kind));
    if (!partsByColumn[field.columnKey]) partsByColumn[field.columnKey] = [];
    partsByColumn[field.columnKey].push({ fieldId: field.id, label: field.label, values, writes, separator });
  }

  const row = {};
  for (const [columnKey, parts] of Object.entries(partsByColumn)) {
    const format = project.columnFormats ? project.columnFormats[columnKey] : null;
    row[columnKey] = {
      value: formatColumn(format, parts),
      write: parts.some((part) => part.writes),
      parts,
    };
  }
  return row;
}

/** Labels of required fields that have no value for this product. */
export function missingRequired(project, product) {
  return (project.fields || [])
    .filter((field) => field.required)
    .filter((field) => fieldValues(project, field, product).values.length === 0)
    .map((field) => field.label);
}

/** Columns whose combined value exceeds Excel's per-cell character limit. */
export function oversizedCells(project, product) {
  const row = computeRow(project, product);
  return Object.entries(row)
    .filter(([, cell]) => cell.value.length > EXCEL_CELL_LIMIT)
    .map(([columnKey]) => columnName(project, columnKey));
}

export function columnName(project, columnKey) {
  const column = findColumn(project, columnKey);
  return column ? column.name : '(unassigned)';
}

/**
 * Column used to identify products in the Collect tab's product list.
 * project.labelColumnKey: undefined/null = automatic (a SKU-like column, else a
 * name/title column, else the first non-URL column), '' = none (URL / row only).
 */
export function labelColumn(project) {
  const allColumns = (project && project.columns) || [];
  // Only columns from the spreadsheet have values; the URL column is never a good label.
  const candidates = allColumns.filter((column) => column.index != null && column.key !== project.urlColumnKey);
  const chosenKey = project && project.labelColumnKey;
  if (chosenKey === '') return null;

  if (chosenKey != null) {
    const chosen = candidates.find((column) => column.key === chosenKey);
    if (chosen) return chosen;
    // The chosen column no longer exists (e.g. after a re-import): fall back to automatic.
  }

  const skuColumn = candidates.find((column) => SKU_COLUMN_PATTERN.test(column.name));
  if (skuColumn) return skuColumn;
  const nameColumn = candidates.find((column) => /^(product\s*)?(name|title)$/i.test(column.name));
  if (nameColumn) return nameColumn;
  return candidates[0] || null;
}

/** Short text identifying a product (value of the identifier column, else its URL, else its row). */
export function productLabel(project, product) {
  const column = labelColumn(project);
  const value = column && product.source ? product.source[column.index] : null;
  if (value != null && String(value).trim()) return String(value).trim();
  return product.url || `Row ${product.rowIndex + 1}`;
}

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

/** The project's image settings with defaults filled in and the name column auto-detected if unset. */
export function imageSettings(project) {
  const settings = { ...defaultImageSettings(), ...((project && project.imageSettings) || {}) };
  if (settings.nameColumnKey === undefined || settings.nameColumnKey === null) {
    const columns = (project && project.columns) || [];
    const skuColumn = columns.find((column) => SKU_COLUMN_PATTERN.test(column.name));
    settings.nameColumnKey = skuColumn ? skuColumn.key : '';
  }
  return settings;
}

/** 'main' or 'gallery': decides the file name suffix (-main or -1, -2 …). */
export function imageRole(field) {
  if (field.imageRole) return field.imageRole;
  return field.multiple ? 'gallery' : 'main';
}

const IMAGE_EXTENSION_PATTERN = /\.(jpe?g|png|webp|gif|avif|svg)$/i;

/** Makes a value safe as a file name: letters, digits, dot, dash and underscore. */
export function sanitizeFileName(value, lowercase = false) {
  let name = String(value ?? '').trim().normalize('NFKC');
  // "front.jpg" → "front": the real extension is added later.
  name = name.replace(IMAGE_EXTENSION_PATTERN, '');
  // Anything other than letters, digits, ".", "_" and "-" becomes a dash…
  name = name.replace(/[^\p{L}\p{N}._-]+/gu, '-');
  // …without repeated dashes, or dashes and dots at either end.
  name = name.replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  if (lowercase) name = name.toLowerCase();
  return name.slice(0, 120);
}

/** Value of a column for a product: what a (non-image) field writes there, else the spreadsheet value. */
function columnText(project, product, columnKey) {
  const fieldsInColumn = (project.fields || []).filter((field) => field.columnKey === columnKey && field.kind !== 'image');
  for (const field of fieldsInColumn) {
    const { values } = fieldValues(project, field, product);
    if (values.length) return values.join(' ');
  }
  return sourceValue(project, product, columnKey);
}

/** Automatic base name (from the configured column), ignoring the per-product override. */
export function autoImageBaseName(project, product) {
  const settings = imageSettings(project);
  const columnValue = settings.nameColumnKey ? columnText(project, product, settings.nameColumnKey) : '';
  return sanitizeFileName(columnValue, settings.lowercase) || `product-${product.rowIndex + 1}`;
}

/** Base file name for a product's images: the name typed in the Collect tab, else the automatic one. */
export function imageBaseName(project, product) {
  const settings = imageSettings(project);
  const typedName = sanitizeFileName(product.imageName, settings.lowercase);
  return typedName || autoImageBaseName(project, product);
}

/** File extension for the chosen format; "original" keeps the extension of the source URL. */
export function imageExtension(format, sourceUrl) {
  if (format && format !== 'original') return format;

  let path;
  try {
    path = new URL(sourceUrl).pathname; // ignores ?query parameters
  } catch {
    path = String(sourceUrl || '');
  }
  const match = IMAGE_EXTENSION_PATTERN.exec(path);
  if (!match) return 'jpg';
  const extension = match[1].toLowerCase();
  return extension === 'jpeg' ? 'jpg' : extension;
}

/** Public URL of an image file in the new location, e.g. https://example.com/images/tv001-main.jpg */
export function publicImageUrl(baseUrl, fileName) {
  let base = String(baseUrl || '').trim();
  if (!base) return '';
  if (!base.endsWith('/')) base += '/';
  return base + encodeURIComponent(fileName);
}

/** Images collected for a product in one field (entries without a URL are ignored). */
function collectedImages(product, field) {
  const data = product.data ? product.data[field.id] : undefined;
  if (!Array.isArray(data)) return [];
  return data.filter((image) => image && image.url);
}

/**
 * File names for every image of a product, in field order.
 * Main images: <name>-main.<ext> (further ones <name>-main-2 …); gallery images: <name>-1, <name>-2 …
 */
export function planProductImages(project, product) {
  const settings = imageSettings(project);
  const baseName = imageBaseName(project, product);
  const plan = [];
  let mainCount = 0;
  let galleryCount = 0;

  for (const field of project.fields || []) {
    if (field.kind !== 'image' || field.method !== 'visual') continue;
    const role = imageRole(field);

    for (const image of collectedImages(product, field)) {
      let suffix;
      if (role === 'main') {
        mainCount++;
        suffix = mainCount === 1 ? 'main' : `main-${mainCount}`;
      } else {
        galleryCount++;
        suffix = String(galleryCount);
      }
      const fileName = `${baseName}-${suffix}.${imageExtension(settings.format, image.url)}`;
      plan.push({
        rowIndex: product.rowIndex,
        fieldId: field.id,
        fieldLabel: field.label,
        imageId: image.id,
        role,
        sourceUrl: image.url,
        fileName,
        publicUrl: publicImageUrl(settings.baseUrl, fileName),
      });
    }
  }
  return plan;
}

/** "tv001-main.jpg" + row index 4 → "tv001-main-row5.jpg" */
function addRowToFileName(fileName, rowIndex) {
  const dotPosition = fileName.lastIndexOf('.');
  const name = fileName.slice(0, dotPosition);
  const extension = fileName.slice(dotPosition);
  return `${name}-row${rowIndex + 1}${extension}`;
}

/**
 * Plans images for many products and makes file names unique: when two
 * different images would get the same name, later ones get "-row<N>" added.
 * The same image URL used by several products keeps one shared file.
 * Returns { plans: Map(rowIndex → entries), duplicates: [{ fileName, rows }] }.
 */
export function planAllImages(project, products) {
  const settings = imageSettings(project);
  const usedNames = new Map(); // lowercase file name → { sourceUrl, rows }
  const plans = new Map();
  const duplicates = new Map(); // file name → rows that wanted it

  for (const product of products) {
    const entries = [];
    for (const entry of planProductImages(project, product)) {
      const nameKey = entry.fileName.toLowerCase(); // Windows and many servers ignore case
      const existing = usedNames.get(nameKey);

      if (!existing) {
        usedNames.set(nameKey, { sourceUrl: entry.sourceUrl, rows: [entry.rowIndex] });
        entries.push(entry);
      } else if (existing.sourceUrl === entry.sourceUrl) {
        entries.push(entry); // same picture, same file
      } else {
        // A different picture already uses this name: give this one a unique name.
        existing.rows.push(entry.rowIndex);
        duplicates.set(entry.fileName, existing.rows);
        const fileName = addRowToFileName(entry.fileName, entry.rowIndex);
        usedNames.set(fileName.toLowerCase(), { sourceUrl: entry.sourceUrl, rows: [entry.rowIndex] });
        entries.push({ ...entry, fileName, publicUrl: publicImageUrl(settings.baseUrl, fileName) });
      }
    }
    plans.set(product.rowIndex, entries);
  }

  const duplicateList = [];
  for (const [fileName, rows] of duplicates) {
    duplicateList.push({ fileName, rows: [...new Set(rows)] });
  }
  return { plans, duplicates: duplicateList };
}
