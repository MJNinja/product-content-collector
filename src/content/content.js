import { createSelector } from './selector.js';

/*
 * Content script entry. Injected on demand by the side panel with
 * chrome.scripting.executeScript; the guard keeps repeated injections
 * from registering twice.
 */
(() => {
  if (window.__productContentCollector) return;
  window.__productContentCollector = true;

  const send = (msg) => {
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch {
      /* extension reloaded: ignore */
    }
  };

  const selector = createSelector({
    onCapture: (field, payload) => send({ type: 'pcc:captured', fieldId: field.id, kind: field.kind, payload }),
    onStop: (field) => send({ type: 'pcc:stopped', fieldId: field && field.id }),
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'pcc:ping':
        sendResponse({ ok: true, url: location.href, selecting: selector.isActive() });
        break;
      case 'pcc:start':
        selector.start(msg.field);
        sendResponse({ ok: true });
        break;
      case 'pcc:stop':
        selector.stop(false);
        sendResponse({ ok: true });
        break;
      default:
    }
  });
})();
