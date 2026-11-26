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
 *
 * The functions work on real DOM nodes (document.createElement etc.), which is
 * the most reliable way to restructure HTML in the browser.
 */

export const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
const LIST_TAGS = ['ul', 'ol'];

/** Layout-only containers: removed or turned into <p>, since they carry no meaning of their own. */
const WRAPPER_TAGS = ['div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'figure', 'span', 'font', 'center'];

const BLOCK_TAGS = new Set([
  ...HEADING_TAGS, 'p', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'caption', 'blockquote', 'pre', 'hr', 'div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'figure',
  'figcaption', 'center',
]);

/** Tags that may only contain text and inline formatting, not blocks. */
const PHRASING_PARENT_TAGS = ['p', ...HEADING_TAGS, 'li', 'td', 'th', 'dt', 'dd', 'a', 'strong', 'em', 'b', 'i'];

/** Empty tags that still mean something on their own. */
const MEANINGFUL_EMPTY_TAGS = new Set(['br', 'hr', 'img']);

const NON_BREAKING_SPACE = / /g;

export const ALLOWED_TAGS = [
  ...HEADING_TAGS, 'p', 'br', 'hr', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'small', 'mark', 'abbr', 'code', 'pre', 'q', 'cite',
  'a', 'blockquote', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'img',
  'figure', 'figcaption', 'div', 'span', 'section', 'article', 'main', 'aside', 'header', 'footer', 'center',
];
export const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'colspan', 'rowspan'];

/** Tags removed together with everything inside them. */
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
  KEEP_CONTENT: true, // a removed tag (e.g. <font>) keeps its text
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#|\/)/i,
};

function purify(html) {
  return DOMPurify.sanitize(String(html ?? ''), PURIFY_CONFIG);
}

/** Parses an HTML string into a DocumentFragment without running scripts or loading images. */
function parse(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

function tagOf(element) {
  return element.nodeName.toLowerCase();
}

function isElement(node) {
  return node.nodeType === Node.ELEMENT_NODE;
}

function isText(node) {
  return node.nodeType === Node.TEXT_NODE;
}

function isWhitespaceText(node) {
  return isText(node) && !node.textContent.trim();
}

function hasBlockChild(element) {
  return [...element.children].some((child) => BLOCK_TAGS.has(tagOf(child)));
}

/** True when an element has visible content: text, an image, a line break or a rule. */
function isMeaningful(element) {
  if (MEANINGFUL_EMPTY_TAGS.has(tagOf(element))) return true;
  if (element.querySelector && element.querySelector('img,br,hr')) return true;
  const text = (element.textContent || '').replace(NON_BREAKING_SPACE, ' ');
  return text.trim().length > 0;
}

/**
 * The only element inside `container`, or null when there are several
 * elements or there is text next to the element.
 * "<ul>…</ul>" → the ul;  "<p>a</p><p>b</p>" → null;  "Hello <b>x</b>" → null
 */
function singleRootElement(container) {
  const elements = [...container.children];
  if (elements.length !== 1) return null;
  const textOutsideElement = (container.textContent || '').replace(elements[0].textContent, '');
  return textOutsideElement.trim() ? null : elements[0];
}

/** Replaces an element by its children: <span>a <b>b</b></span> → a <b>b</b> */
function unwrap(element) {
  const parent = element.parentNode;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}

/** Changes an element's tag, keeping attributes and children. Returns the new element. */
function rename(element, tag) {
  const replacement = element.ownerDocument.createElement(tag);
  for (const attribute of [...element.attributes]) replacement.setAttribute(attribute.name, attribute.value);
  while (element.firstChild) replacement.appendChild(element.firstChild);
  element.parentNode.replaceChild(replacement, element);
  return replacement;
}

/** The nearest sibling in a direction ('previousSibling' or 'nextSibling'), skipping whitespace-only text. */
function siblingIgnoringWhitespace(node, direction) {
  let sibling = node[direction];
  while (sibling && isWhitespaceText(sibling)) sibling = sibling[direction];
  return sibling;
}

/** Structural clean of all descendants of `container` (container itself untouched). */
function cleanChildren(container) {
  // Work bottom-up (deepest elements first) so inner wrappers are resolved
  // before deciding what to do with the outer ones.
  const elementsDeepestFirst = [...container.querySelectorAll('*')].reverse();

  for (const element of elementsDeepestFirst) {
    if (!container.contains(element)) continue; // already removed with a parent
    const tag = tagOf(element);

    if (tag === 'img') {
      const src = element.getAttribute('src') || '';
      if (!/^https?:/i.test(src)) element.remove(); // data: URIs, placeholders
      continue;
    }

    if (tag === 'a') {
      const href = element.getAttribute('href') || '';
      if (!href || href.startsWith('#')) {
        unwrap(element); // links to nowhere or to the same page: keep the text only
        continue;
      }
    }

    if (!isMeaningful(element)) {
      element.remove();
      continue;
    }

    if (tag === 'span' || tag === 'font') {
      unwrap(element);
      continue;
    }

    if (WRAPPER_TAGS.includes(tag)) {
      const parentTag = element.parentNode && isElement(element.parentNode) ? tagOf(element.parentNode) : 'div';
      // A wrapper around blocks (or inside a paragraph-like tag) is just removed;
      // a wrapper around plain text becomes a paragraph.
      if (hasBlockChild(element) || PHRASING_PARENT_TAGS.includes(parentTag)) unwrap(element);
      else rename(element, 'p');
    }
  }

  // Drop a <br> at the very start or end of a block: it only adds empty space.
  for (const lineBreak of [...container.querySelectorAll('br')]) {
    const parent = lineBreak.parentNode;
    if (!parent || parent === container) continue;
    const isFirst = !siblingIgnoringWhitespace(lineBreak, 'previousSibling');
    const isLast = !siblingIgnoringWhitespace(lineBreak, 'nextSibling');
    if (isFirst || isLast) lineBreak.remove();
  }
}

/** Sanitises arbitrary HTML (used for manual HTML fields and final output). */
export function sanitizeHtml(html) {
  const holder = document.createElement('div');
  holder.appendChild(parse(purify(html)));
  cleanChildren(holder);
  return tidy(purify(holder.innerHTML));
}

/** DOMPurify only (no restructuring): safe to render, identical structure to export. */
export function safeHtml(html) {
  return purify(html);
}

const BLOCK_TAG_IN_HTML = /\s*(<\/?(?:h[1-6]|p|ul|ol|li|dl|dt|dd|table|thead|tbody|tfoot|tr|td|th|blockquote|div|figure|figcaption|caption|pre)\b[^>]*>)\s*/gi;

/** Normalises whitespace: one space between words, none around block tags. */
function tidy(html) {
  return html
    .replace(NON_BREAKING_SPACE, ' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(BLOCK_TAG_IN_HTML, '$1')
    .trim();
}

/** Output tag suggested for a newly captured element. */
function defaultOutputTag(sourceTag, root) {
  if (sourceTag === 'li') return 'p'; // a single list item on its own is a paragraph
  const isWrapperOrUnknown = WRAPPER_TAGS.includes(sourceTag) || !ALLOWED_TAGS.includes(sourceTag);
  if (isWrapperOrUnknown) {
    return root && hasBlockChild(root) ? 'unwrap' : 'p';
  }
  return 'keep';
}

/** The captured element's tag: the hint from the content script, else the first tag in the HTML. */
function capturedTagName(rawHtml, sourceTagHint) {
  if (sourceTagHint) return sourceTagHint.toLowerCase();
  const firstTag = /^\s*<([a-z0-9-]+)/i.exec(rawHtml || '');
  return firstTag ? firstTag[1].toLowerCase() : 'div';
}

/**
 * Cleans the HTML of one captured element.
 * Returns { html, sourceTag, outputTag, text }.
 */
export function cleanCapturedHtml(rawHtml, sourceTagHint) {
  const sourceTag = capturedTagName(rawHtml, sourceTagHint);
  // Wrap first so a non-allowed root tag (e.g. <font>, custom elements) still yields a root.
  const wrapper = parse(purify(`<div>${rawHtml || ''}</div>`)).firstElementChild || document.createElement('div');
  let root = singleRootElement(wrapper);

  if (!root) {
    // Several roots or bare text: store as a fragment, never add a wrapper element.
    cleanChildren(wrapper);
    const outputTag = hasBlockChild(wrapper) ? 'keep' : defaultOutputTag(sourceTag, wrapper);
    return { html: tidy(wrapper.innerHTML), sourceTag, outputTag, text: htmlToText(wrapper.innerHTML) };
  }

  // <section>, <article> etc. are stored as <div>.
  if (WRAPPER_TAGS.includes(tagOf(root)) && tagOf(root) !== 'div') root = rename(root, 'div');
  cleanChildren(root);
  return { html: tidy(root.outerHTML), sourceTag, outputTag: defaultOutputTag(sourceTag, root), text: htmlToText(root.innerHTML) };
}

/**
 * Copies the content of `source` into `target` as inline content: block
 * children are flattened and separated with <br>.
 * <div><p>a</p><p>b</p></div> → a<br>b
 */
function flattenInto(target, source) {
  const doc = target.ownerDocument;
  let breakBeforeNext = false; // set after a block, so following text starts on a new line

  for (const child of [...source.childNodes]) {
    const isBlock = isElement(child) && BLOCK_TAGS.has(tagOf(child));
    if (isBlock) {
      if (target.childNodes.length) target.appendChild(doc.createElement('br'));
      flattenInto(target, child);
      breakBeforeNext = true;
      continue;
    }
    // Skip whitespace at the start and right after a block.
    if (isWhitespaceText(child) && (breakBeforeNext || !target.childNodes.length)) continue;
    if (breakBeforeNext && target.childNodes.length) target.appendChild(doc.createElement('br'));
    breakBeforeNext = false;
    target.appendChild(child.cloneNode(true));
  }
}

/**
 * Changes the root tag of a captured element while keeping nested content and
 * inline formatting. Handles block→inline containers (e.g. DIV with paragraphs → P)
 * and list conversions.
 */
export function changeTag(html, tag) {
  const fragment = parse(purify(html));
  let root = singleRootElement(fragment);
  const isFragment = !root;
  if (isFragment) {
    // Several top-level nodes: use a temporary container that is never output itself.
    root = document.createElement('div');
    while (fragment.firstChild) root.appendChild(fragment.firstChild);
  }
  const fromTag = isFragment ? null : tagOf(root);

  if (!tag || tag === 'keep' || tag === fromTag) {
    return tidy(isFragment ? root.innerHTML : root.outerHTML);
  }
  if (tag === 'unwrap') return tidy(root.innerHTML);

  const result = document.createElement(tag);

  if (LIST_TAGS.includes(tag)) {
    if (LIST_TAGS.includes(fromTag)) {
      // ul ↔ ol: keep the items as they are.
      for (const child of [...root.childNodes]) result.appendChild(child.cloneNode(true));
    } else if (fromTag === 'li') {
      result.appendChild(copyAsListItem(root));
    } else {
      for (const listItem of listItemsFrom(root)) result.appendChild(listItem);
    }
  } else if (tag === 'div' || tag === 'blockquote') {
    // These may contain blocks, but list items need a list around them, so lists are flattened.
    if (LIST_TAGS.includes(fromTag) || fromTag === 'li') {
      flattenInto(result, root);
    } else {
      for (const child of [...root.childNodes]) result.appendChild(child.cloneNode(true));
    }
  } else {
    // Phrasing containers (p, headings, strong, em): may not contain blocks.
    flattenInto(result, root);
  }
  return tidy(result.outerHTML);
}

/** A new <li> with the same content as `element`. */
function copyAsListItem(element) {
  const listItem = document.createElement('li');
  listItem.innerHTML = element.innerHTML;
  return listItem;
}

/**
 * Splits the content of an element into <li> elements: every block child,
 * every existing list item and every line (separated by <br>) becomes one item.
 */
function listItemsFrom(root) {
  const items = [];
  let currentItem = null; // collects inline content (text, <b>, <a> …) until the next break or block

  const finishCurrentItem = () => {
    if (currentItem && isMeaningful(currentItem)) items.push(currentItem);
    currentItem = null;
  };
  const addItem = (listItem) => {
    if (isMeaningful(listItem)) items.push(listItem);
  };

  for (const child of [...root.childNodes]) {
    if (isElement(child)) {
      const tag = tagOf(child);

      if (tag === 'br') {
        finishCurrentItem();
        continue;
      }
      if (tag === 'li') {
        finishCurrentItem();
        addItem(copyAsListItem(child));
        continue;
      }
      if (LIST_TAGS.includes(tag)) {
        finishCurrentItem();
        for (const existingItem of [...child.children]) addItem(copyAsListItem(existingItem));
        continue;
      }
      if (BLOCK_TAGS.has(tag)) {
        finishCurrentItem();
        if (hasBlockChild(child) || child.querySelector('br')) {
          // A block with its own structure (e.g. a div of paragraphs): split it too.
          items.push(...listItemsFrom(child));
        } else {
          const listItem = document.createElement('li');
          flattenInto(listItem, child);
          addItem(listItem);
        }
        continue;
      }
      // Inline elements fall through and are added to the current item.
    }

    if (isWhitespaceText(child) && !currentItem) continue; // no item starts with whitespace
    if (!isElement(child) && !isText(child)) continue; // comments
    if (!currentItem) currentItem = document.createElement('li');
    currentItem.appendChild(child.cloneNode(true));
  }

  finishCurrentItem();
  return items;
}

/** The <li> elements (as HTML) that a piece of content becomes when turned into a list. */
export function listItemsOf(html) {
  const list = parse(changeTag(html, 'ul')).firstElementChild;
  if (!list) return [];
  return [...list.children]
    .filter((child) => tagOf(child) === 'li')
    .map((listItem) => tidy(listItem.outerHTML));
}

/** <ul> or <ol> around the given <li> HTML strings. */
export function buildList(tag, listItemsHtml) {
  const listTag = tag === 'ol' ? 'ol' : 'ul';
  return tidy(purify(`<${listTag}>${listItemsHtml.join('')}</${listTag}>`));
}

/** Combines several selection items (in order) into one list item. */
export function mergeIntoList(items, tag, id) {
  const listItemsHtml = items.flatMap((item) => listItemsOf(renderSelection(item)));
  const html = buildList(tag, listItemsHtml);
  return { id, html, text: htmlToText(html), sourceTag: tag === 'ol' ? 'ol' : 'ul', outputTag: 'keep' };
}

/** Adds the content of `addHtml` as new <li> items at the end of the list in `listHtml`. */
export function appendToList(listHtml, addHtml, tag) {
  const existingTag = rootTag(listHtml);
  const listTag = LIST_TAGS.includes(existingTag) ? existingTag : tag || 'ul';
  return buildList(listTag, [...listItemsOf(listHtml), ...listItemsOf(addHtml)]);
}

/** Tag of the single root element of an HTML snippet, or null for a fragment / plain text. */
export function rootTag(html) {
  const root = singleRootElement(parse(purify(html || '')));
  return root ? tagOf(root) : null;
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
  return (items || [])
    .map(renderSelection)
    .filter((html) => html.trim())
    .join(separator);
}

/** Plain text of some HTML, with a space where blocks and line breaks were. */
export function htmlToText(html) {
  const withSpaces = String(html ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|h[1-6]|li|div|td|th|dt|dd|tr)>/gi, '</$1> ');
  const text = parse(purify(withSpaces)).textContent || '';
  return text.replace(NON_BREAKING_SPACE, ' ').replace(/\s+/g, ' ').trim();
}

/** Pretty-prints HTML for the source view: one block per line, nested lists/tables indented. */
export function formatHtmlSource(html) {
  const NESTING_TAGS = 'ul|ol|table|thead|tbody|tfoot|tr|dl'; // tags whose content is indented
  const opensNesting = new RegExp(`<(?:${NESTING_TAGS})\\b[^>]*>$`, 'i');
  const closesNesting = new RegExp(`^<\\/(?:${NESTING_TAGS})>`, 'i');

  // Step 1: put line breaks after block closing tags and around list/table tags.
  const withLineBreaks = String(html || '')
    .replace(/(<\/(?:h[1-6]|p|li|blockquote|div|dt|dd|td|th|caption|pre|figure|figcaption)>)/gi, '$1\n')
    .replace(new RegExp(`(<(?:${NESTING_TAGS})\\b[^>]*>)`, 'gi'), '$1\n')
    .replace(new RegExp(`(<\\/(?:${NESTING_TAGS})>)`, 'gi'), '\n$1\n');

  // Step 2: indent each line by how many lists/tables it is inside.
  let depth = 0;
  const lines = [];
  for (const rawLine of withLineBreaks.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (closesNesting.test(line)) depth = Math.max(0, depth - 1);
    lines.push('  '.repeat(depth) + line);
    if (opensNesting.test(line)) depth++;
  }
  return lines.join('\n');
}

/** A copy of `list` with the item at position `from` moved to position `to`. */
export function moveItem(list, from, to) {
  const result = [...list];
  const outOfRange = (index) => index < 0 || index >= result.length;
  if (outOfRange(from) || outOfRange(to)) return result;
  const [movedItem] = result.splice(from, 1);
  result.splice(to, 0, movedItem);
  return result;
}
