import { isRestrictedUrl } from '../utils/url.js';

/*
 * Talks to the browser tab that products are opened in and to the content
 * script running there. The content script is injected on demand only, so
 * normal browsing is never affected.
 */

const pinnedTabId = (() => {
  // Testing hook: index.html?tabId=123 targets a specific tab (used by the
  // automated tests, where the panel page is opened as a normal tab).
  const v = new URLSearchParams(location.search).get('tabId');
  return v ? Number(v) : null;
})();

export async function getTargetTab() {
  if (pinnedTabId != null) {
    try {
      return await chrome.tabs.get(pinnedTabId);
    } catch {
      return null;
    }
  }
  // The side panel belongs to one window; its active tab is the product tab.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

export async function openUrl(tabId, url) {
  await chrome.tabs.update(tabId, { url });
}

export function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

/** Injects the content script if it is not already present. Throws a readable error on restricted pages. */
export async function ensureContentScript(tab) {
  if (!tab) throw new Error('No browser tab available.');
  if (isRestrictedUrl(tab.url)) {
    throw new Error('Chrome does not allow extensions to access this page (browser pages, the Web Store and similar). Open a normal web page first.');
  }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'pcc:ping' });
    if (res && res.ok) return;
  } catch {
    /* not injected yet */
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (err) {
    throw new Error(`Could not access this page: ${err.message || err}. If it is a local file, enable "Allow access to file URLs" for the extension.`);
  }
}

export async function startSelection(tab, field) {
  await ensureContentScript(tab);
  await chrome.tabs.sendMessage(tab.id, {
    type: 'pcc:start',
    field: { id: field.id, label: field.label, kind: field.kind, multiple: !!field.multiple || (field.kind === 'html' && ['ul', 'ol'].includes(field.captureAs)), captureAs: field.kind === 'html' ? field.captureAs || 'items' : 'items' },
  });
}

export async function stopSelection(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'pcc:stop' });
  } catch {
    /* page navigated or script gone: nothing to stop */
  }
}
