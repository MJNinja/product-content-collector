import { createSelector } from './selector.js';

/*
 * Content script entry. Injected on demand by the side panel with
 * chrome.scripting.executeScript; the guard keeps repeated injections
 * from registering twice.
 */
(() => {
  if (window.__productContentCollector) return;
  window.__productContentCollector = true;

  /** Sends a message to the side panel; ignored when the panel is closed. */
  const sendToPanel = (message) => {
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      /* extension reloaded: ignore */
    }
  };

  const selector = createSelector({
    onCapture: (field, payload) => sendToPanel({ type: 'pcc:captured', fieldId: field.id, kind: field.kind, payload }),
    onStop: (field) => sendToPanel({ type: 'pcc:stopped', fieldId: field && field.id }),
  });

  // Messages from the side panel.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return;
    switch (message.type) {
      case 'pcc:ping':
        sendResponse({ ok: true, url: location.href, selecting: selector.isActive() });
        break;
      case 'pcc:start':
        selector.start(message.field);
        sendResponse({ ok: true });
        break;
      case 'pcc:stop':
        selector.stop(false);
        sendResponse({ ok: true });
        break;
      default:
        break;
    }
  });
})();
