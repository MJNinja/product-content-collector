import { IMAGE_FORMATS } from './fieldService.js';

/*
 * Downloads product images, resizes / converts them in a canvas and packs
 * them into a ZIP file together with the exported workbook. Runs in the side
 * panel page; the extension's host permission lets it fetch images from any
 * site without CORS restrictions.
 */

// ---------------------------------------------------------------------------
// ZIP (store method – images are already compressed, so no deflate needed)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** files: [{ name, data: Uint8Array }] → Uint8Array of a .zip archive. */
export function createZip(files, now = new Date()) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const local = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
    const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // UTF-8 names
    h.setUint16(8, 0, true); // stored
    h.setUint16(10, time, true);
    h.setUint16(12, date, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true);
    h.setUint16(28, 0, true);
    local.push(new Uint8Array(h.buffer), name, data);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((n, a) => n + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let p = 0;
  for (const a of parts) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Image download and processing
// ---------------------------------------------------------------------------

export async function fetchImage(url, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!blob.size) throw new Error('empty response');
    const type = (res.headers.get('content-type') || blob.type || '').toLowerCase();
    if (type && !type.startsWith('image/') && !type.includes('octet-stream')) throw new Error(`not an image (${type.split(';')[0]})`);
    return blob;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function decode(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  } catch {
    // SVG and some other formats: decode through an <img> element.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const width = img.naturalWidth || 1000;
      const height = img.naturalHeight || 1000;
      return { source: img, width, height, close: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('the file could not be decoded as an image');
    }
  }
}

/** Target size that fits within maxWidth × maxHeight, never upscaling (0 / empty = no limit). */
export function fitSize(width, height, maxWidth, maxHeight) {
  const mw = Number(maxWidth) > 0 ? Number(maxWidth) : Infinity;
  const mh = Number(maxHeight) > 0 ? Number(maxHeight) : Infinity;
  const scale = Math.min(1, mw / width, mh / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Resizes / converts an image blob according to the image settings. */
export async function processImage(blob, settings) {
  const fmt = IMAGE_FORMATS.find((f) => f.value === settings.format) || IMAGE_FORMATS[0];
  if (!fmt.mime) {
    return { blob, width: null, height: null };
  }
  const img = await decode(blob);
  try {
    const size = fitSize(img.width, img.height, settings.maxWidth, settings.maxHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (fmt.mime === 'image/jpeg') {
      // JPG has no transparency: use a white background instead of black.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size.width, size.height);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.source, 0, 0, size.width, size.height);
    const quality = Math.min(100, Math.max(1, Number(settings.quality) || 85)) / 100;
    const out = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('conversion failed'))), fmt.mime, quality),
    );
    return { blob: out, width: size.width, height: size.height };
  } finally {
    img.close();
  }
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Downloads and processes all planned images.
 * entries: [{ rowIndex, fieldLabel, role, sourceUrl, fileName, publicUrl }]
 * Returns { files: [{ name, data }], report: [...], failed }.
 */
export async function collectImages(entries, settings, { onProgress = () => {}, concurrency = 4, folder = 'images/' } = {}) {
  const unique = [];
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.fileName)) continue;
    seen.add(e.fileName);
    unique.push(e);
  }
  const cache = new Map(); // sourceUrl → Promise<Blob>
  const files = [];
  const report = [];
  let done = 0;
  let index = 0;
  onProgress(0, unique.length);

  async function worker() {
    while (index < unique.length) {
      const e = unique[index++];
      const row = { ...e, status: 'ok', error: '', originalBytes: 0, bytes: 0, width: '', height: '' };
      try {
        if (!cache.has(e.sourceUrl)) cache.set(e.sourceUrl, fetchImage(e.sourceUrl));
        const original = await cache.get(e.sourceUrl);
        const res = await processImage(original, settings);
        const data = new Uint8Array(await res.blob.arrayBuffer());
        files.push({ name: folder + e.fileName, data });
        Object.assign(row, { originalBytes: original.size, bytes: data.length, width: res.width ?? '', height: res.height ?? '' });
      } catch (err) {
        row.status = 'failed';
        row.error = err.message || String(err);
      }
      report.push(row);
      done++;
      onProgress(done, unique.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  report.sort((a, b) => a.rowIndex - b.rowIndex || a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));
  return { files, report, failed: report.filter((r) => r.status !== 'ok') };
}

export function reportCsv(report) {
  const head = ['Row', 'Field', 'Role', 'File name', 'New URL', 'Source URL', 'Status', 'Error', 'Width', 'Height', 'Original bytes', 'Output bytes'];
  const lines = report.map((r) =>
    [r.rowIndex + 1, r.fieldLabel, r.role, r.fileName, r.publicUrl, r.sourceUrl, r.status, r.error, r.width, r.height, r.originalBytes, r.bytes]
      .map(csvCell)
      .join(','),
  );
  return `﻿${[head.join(','), ...lines].join('\r\n')}\r\n`;
}
