/*
 * Runs inside the product page. Turns a selected DOM element into portable
 * data: absolute URLs, resolved lazy-loaded images, hidden junk removed.
 * Final sanitisation (DOMPurify) happens in the side panel.
 */

/** Elements that are never product content. */
const JUNK_SELECTOR = [
  'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'svg', 'canvas', 'video', 'audio',
  'button', 'input', 'select', 'textarea', 'form', 'link', 'meta',
  '.sr-only', '.screen-reader-text', '.visually-hidden', '.visuallyhidden', '[aria-hidden="true"]',
].join(',');

/** Image URLs that are lazy-loading placeholders rather than the real picture. */
const PLACEHOLDER_IMAGE = /(^data:|blank\.(gif|png)|placeholder|spacer\.gif|transparent\.(gif|png)|lazy[-_]?load)/i;

/** data-* attributes that themes and lazy-load plugins use for the real or larger image. */
const IMAGE_DATA_ATTRIBUTE = /^data-(large[-_]image|zoom[-_]image|zoom|full|original|src|lazy[-_]src|lazy)$/i;

const IMAGE_FILE_LINK = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i;

/** Makes a URL absolute ("/img/a.jpg" → "https://shop.example/img/a.jpg"); '' when invalid. */
function absoluteUrl(url) {
  if (!url) return '';
  try {
    return new URL(url.trim(), document.baseURI).href;
  } catch {
    return '';
  }
}

function isHttpUrl(url) {
  return /^https?:/i.test(url);
}

/**
 * Parses a srcset attribute: "a.jpg 300w, b.jpg 1200w" → [{ url: 'a.jpg', size: 300 }, { url: 'b.jpg', size: 1200 }].
 * Density descriptors ("2x") are scaled up so they compare roughly with widths.
 */
export function parseSrcset(srcset) {
  const candidates = [];
  if (!srcset) return candidates;

  // Candidates are separated by commas. A comma followed by a space always
  // separates; a comma directly after a descriptor like "300w," does too.
  // Other commas belong to the URL (some image CDNs use them).
  const parts = srcset
    .split(/,\s+/)
    .flatMap((part) => part.split(/(?<=\s[\d.]+[wx]),/));

  for (const part of parts) {
    const match = part.trim().match(/^(\S+)(?:\s+([\d.]+)([wx]))?$/);
    if (!match) continue;
    const [, url, number, unit] = match;
    const value = number ? parseFloat(number) : 1;
    candidates.push({ url, size: unit === 'x' ? value * 1000 : value });
  }
  return candidates;
}

/** Best (largest, non-placeholder) URL for an <img>, considering src, data-src, srcset, data-srcset. */
export function bestImageUrl(img) {
  // Every possible URL gets a score; the highest valid one wins.
  // srcset entries (1000+ by size) > data-* attributes (900-) > currentSrc (500) > src (400).
  const candidates = [];
  const addSrcset = (srcset) => {
    for (const entry of parseSrcset(srcset)) candidates.push({ url: entry.url, score: 1000 + entry.size });
  };

  addSrcset(img.getAttribute('srcset'));
  addSrcset(img.getAttribute('data-srcset'));

  const picture = img.parentElement && img.parentElement.tagName === 'PICTURE' ? img.parentElement : null;
  if (picture) {
    for (const source of picture.querySelectorAll('source')) {
      addSrcset(source.getAttribute('srcset'));
      addSrcset(source.getAttribute('data-srcset'));
    }
  }

  const data = img.dataset || {};
  const dataUrls = [data.largeImage, data.large_image, data.zoomImage, data.zoom, data.full, data.original, data.src, data.lazySrc, data.lazy];
  for (const attributeName of img.getAttributeNames()) {
    if (IMAGE_DATA_ATTRIBUTE.test(attributeName)) dataUrls.push(img.getAttribute(attributeName));
  }
  dataUrls.filter(Boolean).forEach((url, position) => candidates.push({ url, score: 900 - position }));

  if (img.currentSrc) candidates.push({ url: img.currentSrc, score: 500 });
  if (img.getAttribute('src')) candidates.push({ url: img.getAttribute('src'), score: 400 });

  const valid = candidates
    .filter((candidate) => candidate.url && !PLACEHOLDER_IMAGE.test(candidate.url))
    .map((candidate) => ({ ...candidate, url: absoluteUrl(candidate.url) }))
    .filter((candidate) => isHttpUrl(candidate.url))
    .sort((a, b) => b.score - a.score);
  if (valid.length) return valid[0].url;

  // Nothing better found: accept whatever the browser shows, if it is a web URL.
  const shown = absoluteUrl(img.currentSrc || img.getAttribute('src') || '');
  return isHttpUrl(shown) ? shown : '';
}

function isHidden(element) {
  const style = getComputedStyle(element);
  return style.display === 'none' || style.visibility === 'hidden';
}

/** Tracking pixels and spacers (2 px or smaller). */
function isTinyImage(img) {
  const width = img.naturalWidth || parseInt(img.getAttribute('width') || '0', 10);
  const height = img.naturalHeight || parseInt(img.getAttribute('height') || '0', 10);
  return (width > 0 && width <= 2) || (height > 0 && height <= 2);
}

/**
 * Captures an element's cleaned outerHTML and text.
 * The element is copied first, so the page itself is never changed.
 */
export function extractElement(element) {
  const copy = element.cloneNode(true);
  // The original and the copy list their elements in the same order, so
  // originals[i] and copies[i] are the same element. Checks that need the live
  // page (visibility, image size) use the original; changes go to the copy.
  const originals = [element, ...element.querySelectorAll('*')];
  const copies = [copy, ...copy.querySelectorAll('*')];
  const toRemove = [];

  for (let i = 0; i < originals.length; i++) {
    const original = originals[i];
    const copied = copies[i];
    if (!copied) continue;
    const isSelectedElement = i === 0; // never remove the element the user clicked

    if (!isSelectedElement && original.matches(JUNK_SELECTOR)) {
      toRemove.push(copied);
      continue;
    }
    const hasHardlyAnyText = (original.textContent || '').trim().length < 2;
    if (!isSelectedElement && isHidden(original) && hasHardlyAnyText && !original.querySelector('img')) {
      toRemove.push(copied);
      continue;
    }

    if (original.tagName === 'IMG') {
      if (isTinyImage(original)) {
        toRemove.push(copied);
        continue;
      }
      const url = bestImageUrl(original);
      if (url) copied.setAttribute('src', url);
      else toRemove.push(copied);
    } else if (original.tagName === 'A' && original.getAttribute('href')) {
      const href = original.getAttribute('href');
      if (/^javascript:/i.test(href)) copied.removeAttribute('href');
      else if (!href.startsWith('#')) copied.setAttribute('href', original.href); // .href is absolute
    }
  }

  for (const node of toRemove) node.remove();
  const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
  return { html: copy.outerHTML, text, sourceTag: element.tagName.toLowerCase(), pageUrl: location.href };
}

/**
 * Finds the image represented by an element: the element itself, the image
 * under the mouse, its largest visible child image, or a CSS background image
 * on it or one of its two parents.
 */
export function findImage(element, mouseX, mouseY) {
  if (!element) return null;
  if (element.tagName === 'IMG') return element;
  if (element.tagName === 'PICTURE') return element.querySelector('img');

  // An overlay (zoom lens, link) may sit on top of the image: look underneath.
  if (typeof mouseX === 'number' && document.elementsFromPoint) {
    const imageUnderMouse = document.elementsFromPoint(mouseX, mouseY).find((node) => node.tagName === 'IMG');
    if (imageUnderMouse) return imageUnderMouse;
  }

  const visibleImages = [...element.querySelectorAll('img')].filter((img) => !isHidden(img));
  if (visibleImages.length) {
    const area = (img) => img.offsetWidth * img.offsetHeight;
    return visibleImages.sort((a, b) => area(b) - area(a))[0];
  }

  let current = element;
  for (let level = 0; current && level < 3; level++) {
    const background = getComputedStyle(current).backgroundImage;
    if (background && background !== 'none') return current;
    current = current.parentElement;
  }
  return null;
}

/** The image URL for an <img> or an element with a CSS background image. */
export function extractImage(target) {
  if (!target) return null;

  if (target.tagName === 'IMG') {
    const url = bestImageUrl(target);
    if (!url) return null;
    // Many galleries link a thumbnail to the full-size file: prefer that file.
    const link = target.closest('a[href]');
    const linkedFile = link && IMAGE_FILE_LINK.test(link.href) ? link.href : null;
    return { url: linkedFile || url, pageUrl: location.href };
  }

  const background = getComputedStyle(target).backgroundImage; // e.g. url("https://…/a.jpg")
  const match = background && /url\(["']?(.*?)["']?\)/.exec(background);
  if (!match) return null;
  return { url: absoluteUrl(match[1]), pageUrl: location.href };
}
