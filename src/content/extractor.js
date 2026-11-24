/*
 * Runs inside the product page. Turns a selected DOM element into portable
 * data: absolute URLs, resolved lazy-loaded images, hidden junk removed.
 * Final sanitisation (DOMPurify) happens in the side panel.
 */

const JUNK_SELECTOR = [
  'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'svg', 'canvas', 'video', 'audio',
  'button', 'input', 'select', 'textarea', 'form', 'link', 'meta',
  '.sr-only', '.screen-reader-text', '.visually-hidden', '.visuallyhidden', '[aria-hidden="true"]',
].join(',');

const PLACEHOLDER = /(^data:|blank\.(gif|png)|placeholder|spacer\.gif|transparent\.(gif|png)|lazy[-_]?load)/i;

function abs(u) {
  if (!u) return '';
  try {
    return new URL(u.trim(), document.baseURI).href;
  } catch {
    return '';
  }
}

export function parseSrcset(srcset) {
  const out = [];
  if (!srcset) return out;
  const parts = srcset.split(/,\s+/).flatMap((p) => p.split(/(?<=\s[\d.]+[wx]),/));
  for (const part of parts) {
    const m = part.trim().match(/^(\S+)(?:\s+([\d.]+)([wx]))?$/);
    if (!m) continue;
    const n = m[2] ? parseFloat(m[2]) : 1;
    out.push({ url: m[1], size: m[3] === 'x' ? n * 1000 : n });
  }
  return out;
}

/** Best (largest, non-placeholder) URL for an <img>, considering src, data-src, srcset, data-srcset. */
export function bestImageUrl(img) {
  const ds = img.dataset || {};
  const candidates = [];
  const pushSet = (set) => parseSrcset(set).forEach((c) => candidates.push({ url: c.url, score: 1000 + c.size }));
  pushSet(img.getAttribute('srcset'));
  pushSet(img.getAttribute('data-srcset'));
  const pic = img.parentElement && img.parentElement.tagName === 'PICTURE' ? img.parentElement : null;
  if (pic) pic.querySelectorAll('source').forEach((s) => { pushSet(s.getAttribute('srcset')); pushSet(s.getAttribute('data-srcset')); });
  const named = [ds.largeImage, ds.large_image, ds.zoomImage, ds.zoom, ds.full, ds.original, ds.src, ds.lazySrc, ds.lazy];
  img.getAttributeNames().forEach((n) => {
    if (/^data-(large[-_]image|zoom[-_]image|zoom|full|original|src|lazy[-_]src|lazy)$/i.test(n)) named.push(img.getAttribute(n));
  });
  named.filter(Boolean).forEach((u, i) => candidates.push({ url: u, score: 900 - i }));
  if (img.currentSrc) candidates.push({ url: img.currentSrc, score: 500 });
  if (img.getAttribute('src')) candidates.push({ url: img.getAttribute('src'), score: 400 });
  const valid = candidates
    .filter((c) => c.url && !PLACEHOLDER.test(c.url))
    .map((c) => ({ ...c, url: abs(c.url) }))
    .filter((c) => /^https?:/i.test(c.url))
    .sort((a, b) => b.score - a.score);
  if (valid.length) return valid[0].url;
  const src = abs(img.currentSrc || img.getAttribute('src') || '');
  return /^https?:/i.test(src) ? src : '';
}

function isHidden(el) {
  const cs = getComputedStyle(el);
  return cs.display === 'none' || cs.visibility === 'hidden';
}

function isTinyImage(img) {
  const w = img.naturalWidth || parseInt(img.getAttribute('width') || '0', 10);
  const h = img.naturalHeight || parseInt(img.getAttribute('height') || '0', 10);
  return (w > 0 && w <= 2) || (h > 0 && h <= 2);
}

/** Captures an element's cleaned outerHTML and text. */
export function extractElement(el) {
  const clone = el.cloneNode(true);
  const origAll = [el, ...el.querySelectorAll('*')];
  const cloneAll = [clone, ...clone.querySelectorAll('*')];
  const remove = [];
  for (let i = 0; i < origAll.length; i++) {
    const o = origAll[i];
    const c = cloneAll[i];
    if (!c) continue;
    if (i > 0 && o.matches(JUNK_SELECTOR)) { remove.push(c); continue; }
    if (i > 0 && isHidden(o) && (o.textContent || '').trim().length < 2 && !o.querySelector('img')) { remove.push(c); continue; }
    if (o.tagName === 'IMG') {
      if (isTinyImage(o)) { remove.push(c); continue; }
      const url = bestImageUrl(o);
      if (url) c.setAttribute('src', url); else remove.push(c);
    } else if (o.tagName === 'A' && o.getAttribute('href')) {
      const href = o.getAttribute('href');
      if (/^javascript:/i.test(href)) c.removeAttribute('href');
      else if (!href.startsWith('#')) c.setAttribute('href', o.href);
    }
  }
  remove.forEach((n) => n.remove());
  const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  return { html: clone.outerHTML, text, sourceTag: el.tagName.toLowerCase(), pageUrl: location.href };
}

/** Finds the image represented by an element (the element itself, a child image, or a CSS background). */
export function findImage(el, x, y) {
  if (!el) return null;
  if (el.tagName === 'IMG') return el;
  if (el.tagName === 'PICTURE') return el.querySelector('img');
  if (typeof x === 'number' && document.elementsFromPoint) {
    const img = document.elementsFromPoint(x, y).find((n) => n.tagName === 'IMG');
    if (img) return img;
  }
  const imgs = [...el.querySelectorAll('img')].filter((i) => !isHidden(i));
  if (imgs.length) {
    return imgs.sort((a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight)[0];
  }
  let n = el;
  for (let i = 0; n && i < 3; i++, n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundImage;
    if (bg && bg !== 'none') return n;
  }
  return null;
}

export function extractImage(target) {
  if (!target) return null;
  if (target.tagName === 'IMG') {
    const url = bestImageUrl(target);
    if (!url) return null;
    const link = target.closest('a[href]');
    // Many galleries link a thumbnail to the full-size file.
    const linked = link && /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(link.href) ? link.href : null;
    return {
      url: linked || url,
      alt: (target.getAttribute('alt') || '').trim(),
      title: (target.getAttribute('title') || (link && link.getAttribute('title')) || '').trim(),
      pageUrl: location.href,
    };
  }
  const bg = getComputedStyle(target).backgroundImage;
  const m = bg && /url\(["']?(.*?)["']?\)/.exec(bg);
  if (!m) return null;
  return {
    url: abs(m[1]),
    alt: (target.getAttribute('aria-label') || '').trim(),
    title: (target.getAttribute('title') || '').trim(),
    pageUrl: location.href,
  };
}
