import { extractElement, extractImage, findImage } from './extractor.js';

/*
 * Visual element selector. While active it draws a highlight box over the
 * element under the cursor (an overlay in a closed shadow root, so page
 * styles are never touched) and swallows clicks so links and buttons do not
 * fire. Inline elements (span, strong, a…) are promoted to their nearest
 * block-level text container; ↑ / ↓ walk to the parent / back to the child.
 */

const BLOCKERS = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'contextmenu', 'submit', 'touchstart', 'touchend'];
const STOP_AT = new Set(['HTML', 'BODY']);

export function createSelector({ onCapture, onStop }) {
  let active = false;
  let field = null;
  let host = null, root = null, box = null, label = null, bar = null, barText = null;
  let current = null;       // highlighted element
  let base = null;          // element chosen from the mouse position
  let stack = [];           // children visited with ↑, for ↓
  let last = { x: 0, y: 0 };
  let autoStopTimer = null; // single-value fields end selection shortly after a capture

  function buildUi() {
    host = document.createElement('pcc-selector-overlay');
    host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
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
        .bar button:hover { background: #1d4ed8; }
      </style>
      <div class="box"></div><div class="label"></div>
      <div class="bar" part="bar"><span class="t"></span><button type="button" data-pcc="done">Done</button></div>`;
    box = root.querySelector('.box');
    label = root.querySelector('.label');
    bar = root.querySelector('.bar');
    barText = root.querySelector('.t');
    root.querySelector('[data-pcc="done"]').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      stop(true);
    });
    document.documentElement.appendChild(host);
  }

  function isOwn(e) {
    return host && e.composedPath && e.composedPath().includes(host);
  }

  function deepTarget(e) {
    const path = e.composedPath ? e.composedPath() : [];
    const t = path.find((n) => n && n.nodeType === 1) || e.target;
    return t && t.nodeType === 1 ? t : null;
  }

  function promote(el) {
    if (!el || field.kind === 'image') return el;
    let n = el;
    while (n && n.parentElement && !STOP_AT.has(n.parentElement.tagName)) {
      const d = getComputedStyle(n).display;
      if (!d.startsWith('inline') || n.tagName === 'IMG') break;
      n = n.parentElement;
    }
    return n;
  }

  function pick(el, x, y) {
    if (!el || STOP_AT.has(el.tagName)) return null;
    if (field.kind === 'image') return findImage(el, x, y);
    return promote(el);
  }

  function draw() {
    if (!current || !current.isConnected) {
      box.style.display = label.style.display = 'none';
      return;
    }
    const r = current.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    label.textContent = `${current.tagName.toLowerCase()}${current.id ? '#' + current.id : ''} · ${Math.round(r.width)}×${Math.round(r.height)}`;
    label.style.display = 'block';
    label.style.left = `${Math.max(0, r.left)}px`;
    label.style.top = `${r.top > 22 ? r.top - 20 : r.bottom + 2}px`;
  }

  function setCurrent(el) {
    current = el;
    draw();
  }

  function onMove(e) {
    if (isOwn(e)) return;
    last = { x: e.clientX, y: e.clientY };
    const el = pick(deepTarget(e), e.clientX, e.clientY);
    if (el !== base) {
      base = el;
      stack = [];
      setCurrent(el);
    }
  }

  function block(e) {
    if (isOwn(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.type === 'click') {
      // Use the click position if the mouse never moved over the element first.
      if (!current) setCurrent(pick(deepTarget(e), e.clientX, e.clientY));
      capture();
    }
  }

  function capture() {
    if (!current) return;
    let payload;
    if (field.kind === 'image') {
      payload = extractImage(current);
      if (!payload || !payload.url) {
        flashMessage('No image found here – hover directly over an image.');
        return;
      }
    } else {
      payload = extractElement(current);
    }
    box.classList.add('flash');
    setTimeout(() => box && box.classList.remove('flash'), 300);
    onCapture(field, payload);
    if (!field.multiple) {
      const f = field;
      autoStopTimer = setTimeout(() => {
        autoStopTimer = null;
        if (field === f) stop(true);
      }, 150);
    }
  }

  function flashMessage(msg) {
    const prev = barText.innerHTML;
    barText.textContent = msg;
    setTimeout(() => { if (barText) barText.innerHTML = prev; }, 1800);
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      stop(true);
    } else if (e.key === 'ArrowUp' && current && current.parentElement && !STOP_AT.has(current.parentElement.tagName)) {
      e.preventDefault();
      stack.push(current);
      setCurrent(current.parentElement);
    } else if (e.key === 'ArrowDown' && stack.length) {
      e.preventDefault();
      setCurrent(stack.pop());
    } else if (e.key === 'Enter' && current) {
      e.preventDefault();
      capture();
    }
  }

  function onScroll() { draw(); }

  function start(f) {
    if (autoStopTimer) clearTimeout(autoStopTimer);
    autoStopTimer = null;
    if (active) stop(false);
    field = f;
    active = true;
    buildUi();
    const what = f.kind === 'image' ? (f.multiple ? 'images' : 'an image') : (f.multiple ? 'elements' : 'an element');
    barText.innerHTML = '';
    const t = document.createElement('span');
    t.append('Click ', what, ' for ');
    const b = document.createElement('b');
    b.textContent = f.label;
    t.append(b, ' ');
    if (f.captureAs === 'ul' || f.captureAs === 'ol') {
      const m = document.createElement('b');
      m.textContent = f.captureAs === 'ol' ? '(each click → numbered list) ' : '(each click → bullet list) ';
      t.append(m);
    }
    const s = document.createElement('small');
    s.textContent = '↑ parent · ↓ child · Enter select · Esc exit';
    t.append(s);
    barText.append(t);
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseover', onMove, true);
    BLOCKERS.forEach((t2) => window.addEventListener(t2, block, true));
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll, true);
  }

  function stop(notify) {
    if (!active) return;
    active = false;
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseover', onMove, true);
    BLOCKERS.forEach((t) => window.removeEventListener(t, block, true));
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll, true);
    if (host) host.remove();
    host = root = box = label = bar = barText = null;
    current = base = null;
    stack = [];
    const f = field;
    field = null;
    if (notify) onStop(f);
  }

  return { start, stop, isActive: () => active, get field() { return field; }, get last() { return last; } };
}
