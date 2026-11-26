import { IMAGE_FORMATS } from './fieldService.js';

/*
 * Downloads product images, resizes / converts them in a canvas and packs
 * them into a ZIP file together with the exported workbook. Runs in the side
 * panel page; the extension's host permission lets it fetch images from any
 * site without CORS restrictions.
 */

// ---------------------------------------------------------------------------
// ZIP writer
//
// A ZIP file is: for every file a "local header" followed by the file's bytes,
// then a "central directory" listing all files again, then an "end record"
// pointing at that directory. Files are stored without compression ("store"
// method): images are already compressed, so compressing again gains nothing.
// Field layout: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
// All numbers are little-endian, hence the `true` in every setUint call.
// ---------------------------------------------------------------------------

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_RECORD_SIGNATURE = 0x06054b50;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;
const ZIP_VERSION = 20; // 2.0: the minimum version that supports folders
const FLAG_UTF8_NAMES = 0x0800;
const METHOD_STORE = 0;

/*
 * CRC32 checksum, required for every file in a ZIP. This is the standard
 * table-based algorithm: the table holds a precomputed value for each byte.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let byte = 0; byte < 256; byte++) {
    let value = byte;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[byte] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP files store dates in the old MS-DOS format: bit fields packed into two 16-bit numbers. */
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

/** Joins byte arrays into one. */
function concatBytes(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let position = 0;
  for (const part of parts) {
    result.set(part, position);
    position += part.length;
  }
  return result;
}

/** files: [{ name, data: Uint8Array }] → Uint8Array of a .zip archive. */
export function createZip(files, now = new Date()) {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const localParts = [];
  const centralParts = [];
  let offset = 0; // where the next local header starts

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    const checksum = crc32(data);

    const local = new DataView(new ArrayBuffer(LOCAL_HEADER_SIZE));
    local.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
    local.setUint16(4, ZIP_VERSION, true); // version needed to extract
    local.setUint16(6, FLAG_UTF8_NAMES, true);
    local.setUint16(8, METHOD_STORE, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, checksum, true);
    local.setUint32(18, data.length, true); // compressed size (same: not compressed)
    local.setUint32(22, data.length, true); // uncompressed size
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true); // no extra field
    localParts.push(new Uint8Array(local.buffer), name, data);

    const central = new DataView(new ArrayBuffer(CENTRAL_HEADER_SIZE));
    central.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
    central.setUint16(4, ZIP_VERSION, true); // version made by
    central.setUint16(6, ZIP_VERSION, true); // version needed to extract
    central.setUint16(8, FLAG_UTF8_NAMES, true);
    central.setUint16(10, METHOD_STORE, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, checksum, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, name.length, true);
    // Bytes 30–41 (extra field, comment, disk, attributes) stay 0.
    central.setUint32(42, offset, true); // where this file's local header is
    centralParts.push(new Uint8Array(central.buffer), name);

    offset += LOCAL_HEADER_SIZE + name.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(END_RECORD_SIZE));
  end.setUint32(0, END_RECORD_SIGNATURE, true);
  end.setUint16(8, files.length, true); // entries on this disk
  end.setUint16(10, files.length, true); // entries in total
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true); // central directory starts right after the last file

  return concatBytes([...localParts, ...centralParts, new Uint8Array(end.buffer)]);
}

// ---------------------------------------------------------------------------
// Image download and processing
// ---------------------------------------------------------------------------

/** Downloads an image. Throws a short, readable error (e.g. "HTTP 404", "timed out"). */
export async function fetchImage(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (!blob.size) throw new Error('empty response');

    const contentType = (response.headers.get('content-type') || blob.type || '').toLowerCase();
    const looksLikeImage = contentType.startsWith('image/') || contentType.includes('octet-stream');
    if (contentType && !looksLikeImage) {
      throw new Error(`not an image (${contentType.split(';')[0]})`);
    }
    return blob;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Decodes an image file so it can be drawn on a canvas. Call close() when done. */
async function decode(blob) {
  try {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    // SVG and some other formats: decode through an <img> element.
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      // SVGs without a width/height have no natural size: assume 1000 px.
      const width = image.naturalWidth || 1000;
      const height = image.naturalHeight || 1000;
      return { source: image, width, height, close: () => URL.revokeObjectURL(objectUrl) };
    } catch {
      URL.revokeObjectURL(objectUrl);
      throw new Error('the file could not be decoded as an image');
    }
  }
}

/** Target size that fits within maxWidth × maxHeight, never upscaling (0 / empty = no limit). */
export function fitSize(width, height, maxWidth, maxHeight) {
  const widthLimit = Number(maxWidth) > 0 ? Number(maxWidth) : Infinity;
  const heightLimit = Number(maxHeight) > 0 ? Number(maxHeight) : Infinity;
  const scale = Math.min(1, widthLimit / width, heightLimit / height); // 1 = keep the original size
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Resizes / converts an image blob according to the image settings. */
export async function processImage(blob, settings) {
  const format = IMAGE_FORMATS.find((candidate) => candidate.value === settings.format) || IMAGE_FORMATS[0];
  if (!format.mime) {
    return { blob, width: null, height: null }; // "keep original file"
  }

  const image = await decode(blob);
  try {
    const size = fitSize(image.width, image.height, settings.maxWidth, settings.maxHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (format.mime === 'image/jpeg') {
      // JPG has no transparency: use a white background instead of black.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, size.width, size.height);
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image.source, 0, 0, size.width, size.height);

    const qualityPercent = Math.min(100, Math.max(1, Number(settings.quality) || 85));
    const converted = await canvasToBlob(canvas, format.mime, qualityPercent / 100);
    return { blob: converted, width: size.width, height: size.height };
  } finally {
    image.close();
  }
}

/** canvas.toBlob() as a promise. */
function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('conversion failed'))),
      mimeType,
      quality,
    );
  });
}

/** Quotes a CSV value when needed: a "b → "a ""b". */
function csvCell(value) {
  const text = value == null ? '' : String(value);
  const needsQuotes = /[",\n\r]/.test(text);
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Keeps the first entry for each file name. */
function uniqueByFileName(entries) {
  const seen = new Set();
  const unique = [];
  for (const entry of entries) {
    if (seen.has(entry.fileName)) continue;
    seen.add(entry.fileName);
    unique.push(entry);
  }
  return unique;
}

/**
 * Downloads and processes all planned images.
 * entries: [{ rowIndex, fieldLabel, role, sourceUrl, fileName, publicUrl }]
 * Returns { files: [{ name, data }], report: [...], failed }.
 */
export async function collectImages(entries, settings, { onProgress = () => {}, concurrency = 4, folder = 'images/' } = {}) {
  const queue = uniqueByFileName(entries);
  const downloads = new Map(); // sourceUrl → Promise<Blob>, so each URL is downloaded once
  const files = [];
  const report = [];
  let nextIndex = 0;
  let doneCount = 0;
  onProgress(0, queue.length);

  // Each worker takes the next image from the queue until it is empty.
  // Running a few workers at once (`concurrency`) is faster than one by one
  // without flooding the server with requests.
  async function worker() {
    while (nextIndex < queue.length) {
      const entry = queue[nextIndex];
      nextIndex++;
      const reportRow = { ...entry, status: 'ok', error: '', originalBytes: 0, bytes: 0, width: '', height: '' };
      try {
        if (!downloads.has(entry.sourceUrl)) downloads.set(entry.sourceUrl, fetchImage(entry.sourceUrl));
        const original = await downloads.get(entry.sourceUrl);
        const processed = await processImage(original, settings);
        const data = new Uint8Array(await processed.blob.arrayBuffer());
        files.push({ name: folder + entry.fileName, data });
        reportRow.originalBytes = original.size;
        reportRow.bytes = data.length;
        reportRow.width = processed.width ?? '';
        reportRow.height = processed.height ?? '';
      } catch (error) {
        reportRow.status = 'failed';
        reportRow.error = error.message || String(error);
      }
      report.push(reportRow);
      doneCount++;
      onProgress(doneCount, queue.length);
    }
  }

  const workerCount = Math.min(concurrency, queue.length);
  const workers = [];
  for (let i = 0; i < workerCount; i++) workers.push(worker());
  await Promise.all(workers);

  // Workers finish in any order: sort for a stable result.
  const naturalOrder = (a, b) => a.localeCompare(b, undefined, { numeric: true }); // "2" before "10"
  files.sort((a, b) => naturalOrder(a.name, b.name));
  report.sort((a, b) => a.rowIndex - b.rowIndex || naturalOrder(a.fileName, b.fileName));
  return { files, report, failed: report.filter((row) => row.status !== 'ok') };
}

/** The image report as CSV text. Starts with a byte order mark so Excel reads it as UTF-8. */
export function reportCsv(report) {
  const header = ['Row', 'Field', 'Role', 'File name', 'New URL', 'Source URL', 'Status', 'Error', 'Width', 'Height', 'Original bytes', 'Output bytes'];
  const lines = report.map((row) =>
    [row.rowIndex + 1, row.fieldLabel, row.role, row.fileName, row.publicUrl, row.sourceUrl, row.status, row.error, row.width, row.height, row.originalBytes, row.bytes]
      .map(csvCell)
      .join(','),
  );
  const BYTE_ORDER_MARK = '﻿';
  return BYTE_ORDER_MARK + [header.join(','), ...lines].join('\r\n') + '\r\n';
}
