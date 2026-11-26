import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as storage from '../services/storageService.js';
import * as nav from '../services/navigationService.js';
import { cleanCapturedHtml, renderSelection, appendToList, buildList, listItemsOf, htmlToText } from '../services/htmlService.js';
import { missingRequired } from '../services/fieldService.js';
import { createAutosaver } from '../utils/autosave.js';
import { uid } from '../utils/id.js';
import ProjectsView from './components/ProjectsView.jsx';
import ImportView from './components/ImportView.jsx';
import FieldsView from './components/FieldsView.jsx';
import CollectView from './components/CollectView.jsx';
import ExportView from './components/ExportView.jsx';
import { Banner } from './components/common.jsx';

const TABS = [
  { id: 'projects', label: 'Projects' },
  { id: 'import', label: 'Import', needsProject: true },
  { id: 'fields', label: 'Fields', needsProject: true },
  { id: 'collect', label: 'Collect', needsProject: true },
  { id: 'export', label: 'Export', needsProject: true },
];

const LAST_PROJECT_KEY = 'pcc:lastProjectId';

const SAVE_STATE_LABELS = { saving: 'Saving…', error: 'Not saved', saved: 'Saved' };

/** 'ul' or 'ol' when clicks on the page build one list for this field, else null. */
function clickListTag(field) {
  if (field.kind !== 'html') return null;
  return field.captureAs === 'ul' || field.captureAs === 'ol' ? field.captureAs : null;
}

/** A selection item for captured page HTML, cleaned and with a suggested output tag. */
function selectionFromCapture(payload) {
  const cleaned = cleanCapturedHtml(payload.html, payload.sourceTag);
  return {
    id: uid('s_'),
    html: cleaned.html,
    text: payload.text || cleaned.text,
    sourceTag: cleaned.sourceTag,
    outputTag: cleaned.outputTag,
  };
}

/*
 * App holds all state and the actions the tabs use; the tab components get
 * them through one `ctx` object.
 *
 * About the "refs" below: React state (useState) only changes on the next
 * render, but some actions run several steps in a row or are called from
 * Chrome event listeners that were registered once. Each ref mirrors the
 * latest value so those functions always read the current data.
 */

export default function App() {
  const [view, setView] = useState('projects');
  const [project, setProject] = useState(null);
  const [products, setProducts] = useState([]);
  const [message, setMessage] = useState(null); // { type: 'error'|'info'|'success', text }
  const [saveState, setSaveState] = useState('saved');
  const [selecting, setSelecting] = useState(null); // field id being selected on the page
  const [tab, setTab] = useState(null); // the browser tab products are opened in

  const projectRef = useRef(project);
  const productsRef = useRef(products);
  const selectingRef = useRef(selecting);
  const tabRef = useRef(tab);
  projectRef.current = project;
  productsRef.current = products;
  selectingRef.current = selecting;
  tabRef.current = tab;

  const notify = useCallback((type, text) => setMessage(text ? { type, text, id: uid() } : null), []);
  const showError = useCallback((error) => notify('error', error && error.message ? error.message : String(error)), [notify]);

  // ---- autosave -------------------------------------------------------------
  const saver = useMemo(
    () =>
      createAutosaver(
        async (item) => {
          if (item.kind === 'project') await storage.saveProject(item.value);
          else await storage.saveProduct(item.value);
          setSaveState('saved');
        },
        350,
        (error) => {
          setSaveState('error');
          showError(new Error(`Autosave failed: ${error.message || error}`));
        },
      ),
    [showError],
  );

  // Save immediately when the panel is closed or hidden.
  useEffect(() => {
    const flush = () => saver.flush();
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushWhenHidden);
    };
  }, [saver]);

  // Updates are computed from refs synchronously (not inside setState updaters)
  // so the autosave queue is filled immediately and flush() before navigation
  // really writes the latest data.
  // `change` is either an object of properties to set, or a function that
  // receives the current project and returns the new one.
  const updateProject = useCallback(
    (change) => {
      const current = projectRef.current;
      if (!current) return;
      const next = typeof change === 'function' ? change(current) : { ...current, ...change };
      projectRef.current = next;
      setProject(next);
      saver.schedule('project', { kind: 'project', value: next });
      setSaveState('saving');
    },
    [saver],
  );

  /** Updates one product (by list index) immutably and schedules a save. */
  const updateProduct = useCallback(
    (index, change) => {
      const currentList = productsRef.current;
      const current = currentList[index];
      if (!current) return;
      let next = typeof change === 'function' ? change(current) : { ...current, ...change };
      if (next === current) return; // nothing changed
      // Entering data starts a product.
      if (next.status === 'pending' && next.data !== current.data) next = { ...next, status: 'in_progress' };
      const list = [...currentList];
      list[index] = next;
      productsRef.current = list;
      setProducts(list);
      saver.schedule(`product:${next.rowIndex}`, { kind: 'product', value: next });
      setSaveState('saving');
    },
    [saver],
  );

  /** Sets what was collected for one field of one product. `value` may be a function of the old value. */
  const setFieldData = useCallback(
    (index, fieldId, value) => {
      updateProduct(index, (product) => {
        const newValue = typeof value === 'function' ? value(product.data[fieldId]) : value;
        return { ...product, data: { ...product.data, [fieldId]: newValue } };
      });
    },
    [updateProduct],
  );

  // ---- project loading ------------------------------------------------------
  const openProject = useCallback(
    async (id, nextView) => {
      try {
        await saver.flush();
        const loadedProject = await storage.getProject(id);
        if (!loadedProject) throw new Error('Project not found.');
        const loadedProducts = await storage.getProducts(id);
        setProject(loadedProject);
        setProducts(loadedProducts);
        try { localStorage.setItem(LAST_PROJECT_KEY, id); } catch { /* storage blocked: ignore */ }
        // Without products there is nothing to collect yet: start on Import.
        setView(nextView || (loadedProducts.length ? 'collect' : 'import'));
        notify(null);
      } catch (error) {
        showError(error);
      }
    },
    [saver, notify, showError],
  );

  const closeProject = useCallback(async () => {
    await saver.flush();
    if (selectingRef.current && tabRef.current) nav.stopSelection(tabRef.current.id);
    setSelecting(null);
    setProject(null);
    setProducts([]);
    try { localStorage.removeItem(LAST_PROJECT_KEY); } catch { /* ignore */ }
    setView('projects');
  }, [saver]);

  // Reopen the last project after the panel is closed and reopened.
  useEffect(() => {
    let lastProjectId = null;
    try { lastProjectId = localStorage.getItem(LAST_PROJECT_KEY); } catch { /* storage blocked: ignore */ }
    if (lastProjectId) openProject(lastProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- browser tab tracking -------------------------------------------------
  const refreshTab = useCallback(async () => {
    try {
      const targetTab = await nav.getTargetTab();
      setTab(targetTab);
      return targetTab;
    } catch {
      setTab(null);
      return null;
    }
  }, []);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.tabs) return undefined;
    refreshTab();
    const onUpdated = async (tabId, changeInfo, updatedTab) => {
      const currentTab = tabRef.current;
      if (!currentTab || currentTab.id !== tabId) return;
      setTab(updatedTab);
      // Re-arm visual selection after the page navigates (the content script is gone).
      const pageLoaded = changeInfo.status === 'complete';
      if (!pageLoaded || !selectingRef.current) return;
      const field = projectRef.current?.fields.find((candidate) => candidate.id === selectingRef.current);
      if (!field) return;
      try {
        await nav.startSelection(updatedTab, field);
      } catch (error) {
        setSelecting(null);
        showError(error);
      }
    };
    // Switching to another tab ends selection on the previous one.
    const onActivated = async () => {
      const previousTab = tabRef.current;
      const newTab = await refreshTab();
      if (selectingRef.current && previousTab && newTab && previousTab.id !== newTab.id) {
        nav.stopSelection(previousTab.id);
        setSelecting(null);
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onActivated.addListener(onActivated);
    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onActivated.removeListener(onActivated);
    };
  }, [refreshTab, showError]);

  // ---- captures from the content script --------------------------------------
  const currentIndex = project ? Math.min(project.currentIndex || 0, Math.max(products.length - 1, 0)) : 0;
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;

  // The list that "clicks become one list" captures are added to (reset for every new selection session).
  const listTargetRef = useRef(null);

  /** Adds an element or image captured on the page to the current product. */
  const addCapture = useCallback(
    (fieldId, payload) => {
      const field = projectRef.current?.fields.find((candidate) => candidate.id === fieldId);
      if (!field || !payload) return;
      const productIndex = currentIndexRef.current;
      const rowIndex = productsRef.current[productIndex]?.rowIndex;
      const listTag = clickListTag(field);

      setFieldData(productIndex, fieldId, (previousItems) => {
        const items = Array.isArray(previousItems) ? previousItems : [];
        // Single-value fields replace their value; others add to it.
        const withItem = (item) => (field.multiple ? [...items, item] : [item]);

        if (field.kind === 'image') {
          const alreadyAdded = items.some((image) => image.url === payload.url);
          return alreadyAdded ? items : withItem({ id: uid('i_'), url: payload.url });
        }

        if (!listTag || payload.html == null) {
          return withItem(selectionFromCapture(payload));
        }

        // "Clicks build one list": every capture adds <li> items to the same list item.
        const captured = selectionFromCapture(payload);
        const capturedHtml = renderSelection(captured);
        const target = listTargetRef.current;
        const isSameList = target && target.fieldId === fieldId && target.rowIndex === rowIndex && target.tag === listTag;
        const existingList = isSameList ? items.find((item) => item.id === target.itemId) : null;

        if (existingList) {
          const html = appendToList(renderSelection(existingList), capturedHtml, listTag);
          return items.map((item) =>
            item.id === existingList.id ? { ...item, html, outputTag: 'keep', text: htmlToText(html) } : item,
          );
        }

        const html = buildList(listTag, listItemsOf(capturedHtml));
        const newList = { id: uid('s_'), html, text: htmlToText(html), sourceTag: listTag, outputTag: 'keep' };
        listTargetRef.current = { fieldId, itemId: newList.id, rowIndex, tag: listTag };
        return withItem(newList);
      });
    },
    [setFieldData],
  );

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return undefined;
    // Messages from the content script (only from the tab we work in).
    const listener = (message, sender) => {
      if (!message || !sender.tab) return;
      const currentTab = tabRef.current;
      if (currentTab && sender.tab.id !== currentTab.id) return;
      if (message.type === 'pcc:captured') {
        addCapture(message.fieldId, message.payload);
      } else if (message.type === 'pcc:stopped') {
        setSelecting((selectingFieldId) => (selectingFieldId === message.fieldId ? null : selectingFieldId));
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [addCapture]);

  const toggleSelect = useCallback(
    async (field) => {
      try {
        const targetTab = await refreshTab();
        if (!targetTab) throw new Error('No browser tab found.');
        if (selectingRef.current === field.id) {
          await nav.stopSelection(targetTab.id);
          setSelecting(null);
          return;
        }
        listTargetRef.current = null; // a new selection session starts a new list
        await nav.startSelection(targetTab, field);
        setSelecting(field.id);
        notify(null);
      } catch (error) {
        setSelecting(null);
        showError(error);
      }
    },
    [refreshTab, notify, showError],
  );

  // ---- navigation -------------------------------------------------------------
  const openInTab = useCallback(
    async (product) => {
      if (!product) return;
      if (!product.url) {
        notify('error', `Row ${product.rowIndex + 1} has no valid product URL ("${product.rawUrl || 'empty'}"). You can still enter data manually or skip it.`);
        return;
      }
      try {
        const targetTab = await refreshTab();
        if (!targetTab) throw new Error('No browser tab found to open the product in.');
        await nav.openUrl(targetTab.id, product.url);
      } catch (error) {
        showError(error);
      }
    },
    [refreshTab, notify, showError],
  );

  /**
   * Moves to another product: optionally sets the status of the one we leave,
   * stops selection, saves, and opens the new product's URL.
   */
  const goTo = useCallback(
    async (index, { open = true, statusForCurrent } = {}) => {
      const list = productsRef.current;
      if (!list.length) return;
      if (statusForCurrent) {
        updateProduct(currentIndexRef.current, (product) => ({ ...product, status: statusForCurrent }));
      }
      const target = Math.max(0, Math.min(index, list.length - 1)); // keep within the list
      if (selectingRef.current && tabRef.current) {
        await nav.stopSelection(tabRef.current.id);
        setSelecting(null);
      }
      updateProject({ currentIndex: target });
      currentIndexRef.current = target;
      updateProduct(target, (product) => (product.status === 'pending' ? { ...product, status: 'in_progress' } : product));
      await saver.flush(); // save before the page changes
      if (open) await openInTab(list[target]);
    },
    [updateProduct, updateProject, saver, openInTab],
  );

  /** Marks the current product completed (if required fields are filled), optionally moving to the next. */
  const completeCurrent = useCallback(
    async (andNext) => {
      const currentProduct = productsRef.current[currentIndexRef.current];
      const missing = missingRequired(projectRef.current, currentProduct);
      if (missing.length) {
        notify('error', `Required field(s) empty: ${missing.join(', ')}.`);
        return;
      }
      if (andNext && currentIndexRef.current < productsRef.current.length - 1) {
        await goTo(currentIndexRef.current + 1, { statusForCurrent: 'completed' });
      } else {
        updateProduct(currentIndexRef.current, (product) => ({ ...product, status: 'completed' }));
        await saver.flush();
        notify('success', 'Product marked as completed.');
      }
    },
    [goTo, updateProduct, saver, notify],
  );

  /** Changes one field's configuration (used for the capture mode in the Collect tab). */
  const updateField = useCallback(
    async (fieldId, patch) => {
      updateProject((current) => ({
        ...current,
        fields: current.fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)),
      }));
      listTargetRef.current = null;
      // Restart selection so the page uses the new setting.
      if (selectingRef.current === fieldId && tabRef.current) {
        const field = projectRef.current.fields.find((candidate) => candidate.id === fieldId);
        try {
          await nav.startSelection(tabRef.current, field);
        } catch {
          /* page gone: selection re-arms after load */
        }
      }
    },
    [updateProject],
  );

  // Everything the tab components can read and do.
  const ctx = {
    updateField,
    project,
    products,
    currentIndex,
    tab,
    selecting,
    updateProject,
    updateProduct,
    setFieldData,
    toggleSelect,
    goTo,
    openInTab,
    completeCurrent,
    notify,
    showError,
    openProject,
    closeProject,
    setProducts,
    setProject,
    setView,
    saver,
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="title-row">
          <div className="brand" title="Product Content Collector">
            <span className="logo">▣</span>
            <span className="brand-name">{project ? project.name : 'Product Content Collector'}</span>
          </div>
          <span className={`save-state ${saveState}`} data-testid="save-state">
            {SAVE_STATE_LABELS[saveState] || SAVE_STATE_LABELS.saved}
          </span>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((tabInfo) => (
            <button
              key={tabInfo.id}
              role="tab"
              className={view === tabInfo.id ? 'active' : ''}
              aria-selected={view === tabInfo.id}
              disabled={tabInfo.needsProject && !project}
              onClick={() => setView(tabInfo.id)}
              data-testid={`tab-${tabInfo.id}`}
            >
              {tabInfo.label}
            </button>
          ))}
        </nav>
      </header>
      {message && <Banner message={message} onClose={() => setMessage(null)} />}
      <main className="content">
        {view === 'projects' && <ProjectsView ctx={ctx} />}
        {view === 'import' && project && <ImportView ctx={ctx} />}
        {view === 'fields' && project && <FieldsView ctx={ctx} />}
        {view === 'collect' && project && <CollectView ctx={ctx} />}
        {view === 'export' && project && <ExportView ctx={ctx} />}
      </main>
    </div>
  );
}
