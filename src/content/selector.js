import { extractElement, extractImage, findImage } from './extractor.js';

/*
 * Visual element selector. While active it draws a highlight box over the
 * element under the cursor and swallows clicks so links and buttons do not
 * fire. The box and toolbar live in a shadow root, so the page's CSS cannot
 * change them and they cannot change the page.
 *
 * Inline elements (span, strong, a…) are promoted to their nearest
 * block-level text container; ↑ / ↓ walk to the parent / back to the child.
 */

/** Events stopped while selecting, so the page never reacts to the user's clicks. */
const BLOCKED_EVENTS = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'contextmenu', 'submit', 'touchstart', 'touchend'];

/** Never highlight these: they are the whole page. */
const PAGE_ROOT_TAGS = new Set(['HTML', 'BODY']);

const OVERLAY_STYLES = `
  .box { position: fixed; pointer-events: none; border: 2px solid #2563eb; background: rgba(37,99,235,.12);
         border-radius: 3px; transition: all .05s linear; display: none; box-sizing: border-box; }
  .box.flash { border-color: #16a34a; background: rgba(22,163,74,.25); }
  .label { position: fixed; pointer-events: none; background: #1e3a8a; color: #fff; font: 600 11px/1.4 system-ui, sans-serif;
           padding: 2px 6px; border-radius: 3px; display: none; white-space: nowrap; }
  .bar { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); pointer-events: auto;
         background: #111827; color: #f9fafb; font: 13px/1.4 system-ui, sans-serif; padding: 8px 10px 8px 14px;
         border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.35); display: flex; gap: 12px; align-items: center; max-width: 90vw; }
  .bar b { color: #93c5fd; }
  .bar small { color: #9ca3af; }
  .bar button { all: unset; cursor: pointer; background: #2563eb; color: #fff; padding: 5px 12px; border-radius: 6px; font-weight: 600; }
  .bar button:hover { background: #1d4ed8; }`;

/**
 * Creates the selector. onCapture(field, payload) is called for every
 * selected element; onStop(field) when selection ends (Done, Esc, or after
 * one capture for single-value fields).
 */
export function createSelector({ onCapture, onStop }) {
  let active = false;
  let field = null;              // the field being collected: { id, label, kind, multiple, captureAs }

  // Overlay elements (created in buildOverlay, removed in stop)
  let overlayHost = null;
  let highlightBox = null;
  let sizeLabel = null;
  let toolbarText = null;

  let highlighted = null;        // element currently highlighted
  let elementUnderMouse = null;  // element chosen from the mouse position (before ↑ / ↓)
  let visitedChildren = [];      // elements left with ↑, so ↓ can go back
  let autoStopTimer = null;      // single-value fields end selection shortly after a capture

  function buildOverlay() {
    overlayHost = document.createElement('pcc-selector-overlay');
    overlayHost.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
    const shadow = overlayHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${OVERLAY_STYLES}</style>
      <div class="box"></div><div class="label"></div>
      <div class="bar" part="bar"><span class="t"></span><button type="button" data-pcc="done">Done</button></div>`;
    highlightBox = shadow.querySelector('.box');
    sizeLabel = shadow.querySelector('.label');
    toolbarText = shadow.querySelector('.t');
    shadow.querySelector('[data-pcc="done"]').addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      stop(true);
    });
    document.documentElement.appendChild(overlayHost);
  }

  /** True for events on our own toolbar (they must not be blocked). */
  function isOverlayEvent(event) {
    return overlayHost && event.composedPath && event.composedPath().includes(overlayHost);
  }

  /** The innermost element of an event, also inside the page's own shadow DOM components. */
  function eventElement(event) {
    const path = event.composedPath ? event.composedPath() : [];
    const target = path.find((node) => node && node.nodeType === Node.ELEMENT_NODE) || event.target;
    return target && target.nodeType === Node.ELEMENT_NODE ? target : null;
  }

  /** Moves up from inline elements (span, b, a …) to the block that contains the text. */
  function promoteToBlock(element) {
    if (!element || field.kind === 'image') return element;
    let current = element;
    while (current && current.parentElement && !PAGE_ROOT_TAGS.has(current.parentElement.tagName)) {
      const display = getComputedStyle(current).display;
      const isInline = display.startsWith('inline') && current.tagName !== 'IMG';
      if (!isInline) break;
      current = current.parentElement;
    }
    return current;
  }

  /** The element to highlight for what is under the mouse. */
  function elementToHighlight(element, mouseX, mouseY) {
    if (!element || PAGE_ROOT_TAGS.has(element.tagName)) return null;
    if (field.kind === 'image') return findImage(element, mouseX, mouseY);
    return promoteToBlock(element);
  }

  function drawHighlight() {
    if (!highlighted || !highlighted.isConnected) {
      highlightBox.style.display = 'none';
      sizeLabel.style.display = 'none';
      return;
    }
    const rect = highlighted.getBoundingClientRect();
    Object.assign(highlightBox.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });

    // Label like "ul#specs · 640×120", above the box (or below it at the top of the window).
    const idPart = highlighted.id ? `#${highlighted.id}` : '';
    sizeLabel.textContent = `${highlighted.tagName.toLowerCase()}${idPart} · ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    sizeLabel.style.display = 'block';
    sizeLabel.style.left = `${Math.max(0, rect.left)}px`;
    sizeLabel.style.top = `${rect.top > 22 ? rect.top - 20 : rect.bottom + 2}px`;
  }

  function setHighlighted(element) {
    highlighted = element;
    drawHighlight();
  }

  function onMouseMove(event) {
    if (isOverlayEvent(event)) return;
    const element = elementToHighlight(eventElement(event), event.clientX, event.clientY);
    if (element !== elementUnderMouse) {
      elementUnderMouse = element;
      visitedChildren = [];
      setHighlighted(element);
    }
  }

  function blockPageEvent(event) {
    if (isOverlayEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.type === 'click') {
      // Use the click position if the mouse never moved over the element first.
      if (!highlighted) setHighlighted(elementToHighlight(eventElement(event), event.clientX, event.clientY));
      capture();
    }
  }

  function capture() {
    if (!highlighted) return;

    let payload;
    if (field.kind === 'image') {
      payload = extractImage(highlighted);
      if (!payload || !payload.url) {
        showTemporaryMessage('No image found here – hover directly over an image.');
        return;
      }
    } else {
      payload = extractElement(highlighted);
    }

    // Short green flash as feedback.
    highlightBox.classList.add('flash');
    setTimeout(() => highlightBox && highlightBox.classList.remove('flash'), 300);
    onCapture(field, payload);

    if (!field.multiple) {
      // Stop shortly after, unless selection was restarted for another field in the meantime.
      const capturedField = field;
      autoStopTimer = setTimeout(() => {
        autoStopTimer = null;
        if (field === capturedField) stop(true);
      }, 150);
    }
  }

  function showTemporaryMessage(message) {
    const previousContent = [...toolbarText.childNodes];
    toolbarText.textContent = message;
    setTimeout(() => {
      if (toolbarText) toolbarText.replaceChildren(...previousContent);
    }, 1800);
  }

  function onKeyDown(event) {
    const canGoUp = highlighted && highlighted.parentElement && !PAGE_ROOT_TAGS.has(highlighted.parentElement.tagName);

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      stop(true);
    } else if (event.key === 'ArrowUp' && canGoUp) {
      event.preventDefault();
      visitedChildren.push(highlighted);
      setHighlighted(highlighted.parentElement);
    } else if (event.key === 'ArrowDown' && visitedChildren.length) {
      event.preventDefault();
      setHighlighted(visitedChildren.pop());
    } else if (event.key === 'Enter' && highlighted) {
      event.preventDefault();
      capture();
    }
  }

  /** Toolbar text, e.g. "Click elements for Product description (each click → bullet list) ↑ parent · …". */
  function buildToolbarText(selectedField) {
    let what;
    if (selectedField.kind === 'image') what = selectedField.multiple ? 'images' : 'an image';
    else what = selectedField.multiple ? 'elements' : 'an element';

    const text = document.createElement('span');
    const fieldName = document.createElement('b');
    fieldName.textContent = selectedField.label;
    text.append('Click ', what, ' for ', fieldName, ' ');

    if (selectedField.captureAs === 'ul' || selectedField.captureAs === 'ol') {
      const listHint = document.createElement('b');
      listHint.textContent = selectedField.captureAs === 'ol' ? '(each click → numbered list) ' : '(each click → bullet list) ';
      text.append(listHint);
    }

    const keys = document.createElement('small');
    keys.textContent = '↑ parent · ↓ child · Enter select · Esc exit';
    text.append(keys);
    return text;
  }

  // Listeners use the capture phase (`true`) so they run before the page's own handlers.
  function addListeners() {
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseover', onMouseMove, true);
    for (const type of BLOCKED_EVENTS) window.addEventListener(type, blockPageEvent, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', drawHighlight, true);
    window.addEventListener('resize', drawHighlight, true);
  }

  function removeListeners() {
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('mouseover', onMouseMove, true);
    for (const type of BLOCKED_EVENTS) window.removeEventListener(type, blockPageEvent, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', drawHighlight, true);
    window.removeEventListener('resize', drawHighlight, true);
  }

  function start(selectedField) {
    if (autoStopTimer) clearTimeout(autoStopTimer);
    autoStopTimer = null;
    if (active) stop(false);

    field = selectedField;
    active = true;
    buildOverlay();
    toolbarText.replaceChildren(buildToolbarText(selectedField));
    addListeners();
  }

  /** Ends selection; `notify` tells the side panel (not needed when it asked us to stop). */
  function stop(notify) {
    if (!active) return;
    active = false;
    removeListeners();
    if (overlayHost) overlayHost.remove();
    overlayHost = highlightBox = sizeLabel = toolbarText = null;
    highlighted = elementUnderMouse = null;
    visitedChildren = [];

    const stoppedField = field;
    field = null;
    if (notify) onStop(stoppedField);
  }

  return { start, stop, isActive: () => active };
}
