import DOMPurify from 'dompurify';

/*
 * HTML cleaning for captured product content.
 *
 * Pipeline for a captured element:
 *   raw outerHTML (from the page, already made URL-absolute and stripped of
 *   hidden junk by the content script)
 *     -> DOMPurify (tag/attribute allow-list, drops scripts, handlers, styles)
 *     -> structural clean (unwrap span/div wrappers, drop empties)
 *     -> stored as a selection item { html, sourceTag, outputTag }
 * At render/export time the output tag is applied with changeTag() and the
 * result passes through DOMPurify once more.
 */

export const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
const LIST_TAGS = ['ul', 'ol'];
const WRAPPER_TAGS = ['div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'figure', 'span', 'font', 'center'];
const BLOCK_TAGS = new Set([
  ...HEADING_TAGS, 'p', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'caption', 'blockquote', 'pre', 'hr', 'div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'figure',
  'figcaption', 'center',
]);
const VOID_KEEP = new Set(['br', 'hr', 'img']);

export const ALLOWED_TAGS = [
  ...HEADING_TAGS, 'p', 'br', 'hr', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'small', 'mark', 'abbr', 'code', 'pre', 'q', 'cite',
  'a', 'blockquote', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'img',
  'figure', 'figcaption', 'div', 'span', 'section', 'article', 'main', 'aside', 'header', 'footer', 'center',
];
export const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'colspan', 'rowspan'];

const FORBID_CONTENTS = [
  'script', 'style', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'svg', 'math', 'canvas', 'video', 'audio', 'picture', 'source', 'track', 'button', 'select', 'option',
  'textarea', 'input', 'form', 'label', 'nav', 'link', 'meta', 'title', 'head', 'dialog', 'slot',
];

/** Output tags offered in the UI. 'keep' = original tag, 'unwrap' = children only. */
export const OUTPUT_TAG_OPTIONS = ['keep', 'unwrap', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'ul', 'ol', 'blockquote', 'strong', 'em'];

const PURIFY_CONFIG = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  FORBID_CONTENTS,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  KEEP_CONTENT: true,
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#|\/)/i,
};

function purify(html) {
  return DOMPurify.sanitize(String(html ?? ''), PURIFY_CONFIG);
}

function parse(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content;
}

function serialize(fragment) {
  const div = document.createElement('div');
  div.appendChild(fragment.cloneNode(true));
  return div.innerHTML;
}

function tagOf(el) {
  return el.nodeName.toLowerCase();
}

function hasBlockChild(el) {
  return [...el.children].some((c) => BLOCK_TAGS.has(tagOf(c)));
}

function isMeaningful(el) {
  if (VOID_KEEP.has(tagOf(el))) return true;
  if (el.querySelector && el.querySelector('img,br,hr')) return true;
  return (el.textContent || '').replace(/ /g, ' ').trim().length > 0;
}

function unwrap(el) {
  const parent = el.parentNode;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function rename(el, tag) {
  const doc = el.ownerDocument;
  const n = doc.createElement(tag);
  for (const a of [...el.attributes]) n.setAttribute(a.name, a.value);
  while (el.firstChild) n.appendChild(el.firstChild);
  el.parentNode.replaceChild(n, el);
  return n;
}

/** Structural clean of all descendants of `container` (container itself untouched). */
function cleanChildren(container) {
  // Bottom-up so inner wrappers are resolved before outer decisions.
  const all = [...container.querySelectorAll('*')].reverse();
  for (const el of all) {
    if (!container.contains(el)) continue;
    const tag = tagOf(el);
    if (tag === 'img') {
      const src = el.getAttribute('src') || '';
      if (!/^https?:/i.test(src)) el.remove();
      continue;
    }
    if (tag === 'a') {
      const href = el.getAttribute('href') || '';
      if (!href || href.startsWith('#')) {
        unwrap(el);
        continue;
      }
    }
    if (!isMeaningful(el)) {
      el.remove();
      continue;
    }
    if (tag === 'span' || tag === 'font') {
      unwrap(el);
      continue;
    }
    if (WRAPPER_TAGS.includes(tag)) {
      const parentTag = el.parentNode && el.parentNode.nodeType === 1 ? tagOf(el.parentNode) : 'div';
      const parentIsPhrasing = ['p', ...HEADING_TAGS, 'li', 'td', 'th', 'dt', 'dd', 'a', 'strong', 'em', 'b', 'i'].includes(parentTag);
      if (hasBlockChild(el) || parentIsPhrasing) unwrap(el);
      else rename(el, 'p');
    }
  }
  // Drop a <br> at the very start/end of block containers.
  for (const br of [...container.querySelectorAll('br')]) {
    const p = br.parentNode;
    const sib = (n, dir) => {
      let x = n[dir];
      while (x && x.nodeType === 3 && !x.textContent.trim()) x = x[dir];
      return x;
    };
    if (p && p !== container && (!sib(br, 'previousSibling') || !sib(br, 'nextSibling'))) br.remove();
  }
}

/** Sanitises arbitrary HTML (used for manual HTML fields and final output). */
export function sanitizeHtml(html) {
  const clean = purify(html);
  const frag = parse(clean);
  const holder = document.createElement('div');
  holder.appendChild(frag);
  cleanChildren(holder);
  return tidy(purify(holder.innerHTML));
}

/** DOMPurify only (no restructuring): safe to render, identical structure to export. */
export function safeHtml(html) {
  return purify(html);
}

function tidy(html) {
  return html
    .replace(/ /g, ' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/\s*(<\/?(?:h[1-6]|p|ul|ol|li|dl|dt|dd|table|thead|tbody|tfoot|tr|td|th|blockquote|div|figure|figcaption|caption|pre)\b[^>]*>)\s*/gi, '$1')
    .trim();
}

function defaultOutputTag(sourceTag, root) {
  if (sourceTag === 'li') return 'p';
  if (WRAPPER_TAGS.includes(sourceTag) || !ALLOWED_TAGS.includes(sourceTag)) {
    return root && hasBlockChild(root) ? 'unwrap' : 'p';
  }
  return 'keep';
}

/**
 * Cleans the HTML of one captured element.
 * Returns { html, sourceTag, outputTag, text } — html always has a single root element.
 */
export function cleanCapturedHtml(rawHtml, sourceTagHint) {
  const sourceTag = (sourceTagHint || (/^\s*<([a-z0-9-]+)/i.exec(rawHtml || '') || [])[1] || 'div').toLowerCase();
  // Wrap first so a non-allowed root tag (e.g. <font>, custom elements) still yields a root.
  const clean = purify(`<div>${rawHtml || ''}</div>`);
  const frag = parse(clean);
  let outer = frag.firstElementChild;
  if (!outer) outer = document.createElement('div');
  let root = outer.children.length === 1 && !(outer.textContent || '').replace(outer.children[0].textContent, '').trim()
    ? outer.children[0]
    : outer;
  const synthetic = root === outer; // several roots or bare text: store as a fragment, never add a wrapper
  if (!synthetic && WRAPPER_TAGS.includes(tagOf(root)) && tagOf(root) !== 'div') root = rename(root, 'div');
  if (!synthetic) outer = root;
  cleanChildren(outer);
  const text = htmlToText(outer.innerHTML);
  if (synthetic) {
    const html = tidy(outer.innerHTML);
    return { html, sourceTag, outputTag: hasBlockChild(outer) ? 'keep' : defaultOutputTag(sourceTag, outer), text };
  }
  const html = tidy(outer.outerHTML);
  return { html, sourceTag, outputTag: defaultOutputTag(sourceTag, outer), text };
}

/** Converts the children of `el` into inline content, separating former blocks with <br>. */
function flattenInto(target, el) {
  const doc = target.ownerDocument;
  let needBreak = false;
  for (const child of [...el.childNodes]) {
    const isBlock = child.nodeType === 1 && BLOCK_TAGS.has(tagOf(child));
    if (isBlock) {
      if (target.childNodes.length) target.appendChild(doc.createElement('br'));
      flattenInto(target, child);
      needBreak = true;
    } else {
      if (child.nodeType === 3 && !child.textContent.trim() && (needBreak || !target.childNodes.length)) continue;
      if (needBreak && target.childNodes.length) target.appendChild(doc.createElement('br'));
      needBreak = false;
      target.appendChild(child.cloneNode(true));
    }
  }
}

/**
 * Changes the root tag of a captured element while keeping nested content and
 * inline formatting. Handles block→inline containers (e.g. DIV with paragraphs → P)
 * and list conversions.
 */
export function changeTag(html, tag) {
  const frag = parse(purify(html));
  const elements = [...frag.children];
  let root;
  let synthetic = false;
  if (elements.length === 1 && !(frag.textContent || '').replace(elements[0].textContent, '').trim()) {
    root = elements[0];
  } else {
    // Several top-level nodes: a temporary container that is never output itself.
    synthetic = true;
    root = document.createElement('div');
    while (frag.firstChild) root.appendChild(frag.firstChild);
  }
  const from = synthetic ? null : tagOf(root);
  if (!tag || tag === 'keep' || tag === from) return tidy(synthetic ? root.innerHTML : root.outerHTML);
  if (tag === 'unwrap') return tidy(root.innerHTML);

  const out = document.createElement(tag);
  if (LIST_TAGS.includes(tag)) {
    if (LIST_TAGS.includes(from)) {
      for (const c of [...root.childNodes]) out.appendChild(c.cloneNode(true));
    } else if (from === 'li') {
      const li = document.createElement('li');
      li.innerHTML = root.innerHTML;
      out.appendChild(li);
    } else {
      for (const li of listItemsFrom(root)) out.appendChild(li);
    }
  } else if (['div', 'blockquote'].includes(tag)) {
    if (LIST_TAGS.includes(from) || from === 'li') {
      flattenInto(out, root);
    } else {
      for (const c of [...root.childNodes]) out.appendChild(c.cloneNode(true));
    }
  } else {
    // Phrasing containers (p, headings, strong, em): may not contain blocks.
    flattenInto(out, root);
  }
  return tidy(out.outerHTML);
}

/**
 * Splits the content of an element into <li> elements: every block child,
 * every existing list item and every line (separated by <br>) becomes one item.
 */
function listItemsFrom(root) {
  const items = [];
  let cur = null;
  const flush = () => {
    if (cur && isMeaningful(cur)) items.push(cur);
    cur = null;
  };
  for (const c of [...root.childNodes]) {
    if (c.nodeType === 1) {
      const t = tagOf(c);
      if (t === 'br') {
        flush();
        continue;
      }
      if (t === 'li') {
        flush();
        const li = document.createElement('li');
        li.innerHTML = c.innerHTML;
        if (isMeaningful(li)) items.push(li);
        continue;
      }
      if (LIST_TAGS.includes(t)) {
        flush();
        for (const item of [...c.children]) {
          const li = document.createElement('li');
          li.innerHTML = item.innerHTML;
          if (isMeaningful(li)) items.push(li);
        }
        continue;
      }
      if (BLOCK_TAGS.has(t)) {
        flush();
        if (hasBlockChild(c) || c.querySelector('br')) items.push(...listItemsFrom(c));
        else {
          const li = document.createElement('li');
          flattenInto(li, c);
          if (isMeaningful(li)) items.push(li);
        }
        continue;
      }
    }
    if (c.nodeType === 3 && !c.textContent.trim() && !cur) continue;
    if (c.nodeType !== 1 && c.nodeType !== 3) continue;
    if (!cur) cur = document.createElement('li');
    cur.appendChild(c.cloneNode(true));
  }
  flush();
  return items;
}

/** The <li> elements (as HTML) that a piece of content becomes when turned into a list. */
export function listItemsOf(html) {
  const frag = parse(changeTag(html, 'ul'));
  const list = frag.firstElementChild;
  if (!list) return [];
  return [...list.children].filter((c) => tagOf(c) === 'li').map((li) => tidy(li.outerHTML));
}

export function buildList(tag, liHtml) {
  const t = tag === 'ol' ? 'ol' : 'ul';
  return tidy(purify(`<${t}>${liHtml.join('')}</${t}>`));
}

/** Combines several selection items (in order) into one list item. */
export function mergeIntoList(items, tag, id) {
  const lis = items.flatMap((i) => listItemsOf(renderSelection(i)));
  const html = buildList(tag, lis);
  return { id, html, text: htmlToText(html), sourceTag: tag === 'ol' ? 'ol' : 'ul', outputTag: 'keep' };
}

/** Adds the content of `addHtml` as new <li> items at the end of the list in `listHtml`. */
export function appendToList(listHtml, addHtml, tag) {
  const t = rootTag(listHtml);
  const listTag = LIST_TAGS.includes(t) ? t : tag || 'ul';
  return buildList(listTag, [...listItemsOf(listHtml), ...listItemsOf(addHtml)]);
}

function wrapNode(node) {
  const d = document.createElement('div');
  d.appendChild(node.cloneNode(true));
  return d;
}

/** Tag of the single root element of an HTML snippet, or null for a fragment / plain text. */
export function rootTag(html) {
  const frag = parse(purify(html || ''));
  const els = [...frag.children];
  if (els.length !== 1) return null;
  if ((frag.textContent || '').replace(els[0].textContent, '').trim()) return null;
  return tagOf(els[0]);
}

/**
 * Applies HTML the user typed for one selection. The edited text is what gets
 * exported (output tag "keep"); no wrapper element is ever added.
 */
export function applyHtmlEdit(item, editedHtml) {
  const html = tidy(purify(editedHtml || ''));
  return { ...item, html, outputTag: 'keep', text: htmlToText(html) };
}

/** Final HTML for one selection item. */
export function renderSelection(item) {
  if (!item) return '';
  const tag = item.outputTag || 'keep';
  return tidy(purify(changeTag(item.html || '', tag)));
}

/** Combines selection items into one HTML string, preserving order. */
export function combineSelections(items, separator = '\n') {
  return (items || []).map(renderSelection).filter((h) => h.trim()).join(separator);
}

export function htmlToText(html) {
  const frag = parse(purify(String(html ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|h[1-6]|li|div|td|th|dt|dd|tr)>/gi, '</$1> ')));
  return (frag.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/** Pretty-prints HTML for the source view: one block per line, nested lists/tables indented. */
export function formatHtmlSource(html) {
  const NEST = 'ul|ol|table|thead|tbody|tfoot|tr|dl';
  const text = String(html || '')
    .replace(/(<\/(?:h[1-6]|p|li|blockquote|div|dt|dd|td|th|caption|pre|figure|figcaption)>)/gi, '$1\n')
    .replace(new RegExp(`(<(?:${NEST})\\b[^>]*>)`, 'gi'), '$1\n')
    .replace(new RegExp(`(<\\/(?:${NEST})>)`, 'gi'), '\n$1\n');
  const closeRe = new RegExp(`^<\\/(?:${NEST})>`, 'i');
  const openRe = new RegExp(`<(?:${NEST})\\b[^>]*>$`, 'i');
  let depth = 0;
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (closeRe.test(line)) depth = Math.max(0, depth - 1);
    out.push('  '.repeat(depth) + line);
    if (openRe.test(line)) depth++;
  }
  return out.join('\n');
}

export function moveItem(list, from, to) {
  const arr = [...list];
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) return arr;
  const [x] = arr.splice(from, 1);
  arr.splice(to, 0, x);
  return arr;
}
