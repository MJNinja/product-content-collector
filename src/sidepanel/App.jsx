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

export default function App() {
  const [view, setView] = useState('projects');
  const [project, setProject] = useState(null);
  const [products, setProducts] = useState([]);
  const [message, setMessage] = useState(null); // { type: 'error'|'info'|'success', text }
  const [saveState, setSaveState] = useState('saved');
  const [selecting, setSelecting] = useState(null); // field id being selected on the page
  const [tab, setTab] = useState(null);

  const projectRef = useRef(project);
  const productsRef = useRef(products);
  const selectingRef = useRef(selecting);
  const tabRef = useRef(tab);
  projectRef.current = project;
  productsRef.current = products;
  selectingRef.current = selecting;
  tabRef.current = tab;

  const notify = useCallback((type, text) => setMessage(text ? { type, text, id: uid() } : null), []);
  const showError = useCallback((err) => notify('error', err && err.message ? err.message : String(err)), [notify]);

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
        (err) => {
          setSaveState('error');
          showError(new Error(`Autosave failed: ${err.message || err}`));
        },
      ),
    [showError],
  );

  useEffect(() => {
    const flush = () => saver.flush();
    const onVis = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [saver]);

  // Updates are computed from refs synchronously (not inside setState updaters)
  // so the autosave queue is filled immediately and flush() before navigation
  // really writes the latest data.
  const updateProject = useCallback(
    (patch) => {
      const prev = projectRef.current;
      if (!prev) return;
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
      projectRef.current = next;
      setProject(next);
      saver.schedule('project', { kind: 'project', value: next });
      setSaveState('saving');
    },
    [saver],
  );

  /** Updates one product (by list index) immutably and schedules a save. */
  const updateProduct = useCallback(
    (index, updater) => {
      const prev = productsRef.current;
      const old = prev[index];
      if (!old) return;
      let next = typeof updater === 'function' ? updater(old) : { ...old, ...updater };
      if (next === old) return;
      if (next.status === 'pending' && next.data !== old.data) next = { ...next, status: 'in_progress' };
      const list = [...prev];
      list[index] = next;
      productsRef.current = list;
      setProducts(list);
      saver.schedule(`product:${next.rowIndex}`, { kind: 'product', value: next });
      setSaveState('saving');
    },
    [saver],
  );

  const setFieldData = useCallback(
    (index, fieldId, value) => {
      updateProduct(index, (p) => ({ ...p, data: { ...p.data, [fieldId]: typeof value === 'function' ? value(p.data[fieldId]) : value } }));
    },
    [updateProduct],
  );

  // ---- project loading ------------------------------------------------------
  const openProject = useCallback(
    async (id, nextView) => {
      try {
        await saver.flush();
        const p = await storage.getProject(id);
        if (!p) throw new Error('Project not found.');
        const list = await storage.getProducts(id);
        setProject(p);
        setProducts(list);
        try { localStorage.setItem(LAST_PROJECT_KEY, id); } catch { /* ignore */ }
        setView(nextView || (list.length ? 'collect' : 'import'));
        notify(null);
      } catch (err) {
        showError(err);
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
    let id = null;
    try { id = localStorage.getItem(LAST_PROJECT_KEY); } catch { /* ignore */ }
    if (id) openProject(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- browser tab tracking -------------------------------------------------
  const refreshTab = useCallback(async () => {
    try {
      const t = await nav.getTargetTab();
      setTab(t);
      return t;
    } catch {
      setTab(null);
      return null;
    }
  }, []);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.tabs) return undefined;
    refreshTab();
    const onUpdated = async (tabId, info, t) => {
      const cur = tabRef.current;
      if (!cur || cur.id !== tabId) return;
      setTab(t);
      // Re-arm visual selection after the page navigates (the content script is gone).
      if (info.status === 'complete' && selectingRef.current) {
        const field = projectRef.current?.fields.find((f) => f.id === selectingRef.current);
        if (field) {
          try {
            await nav.startSelection(t, field);
          } catch (err) {
            setSelecting(null);
            showError(err);
          }
        }
      }
    };
    const onActivated = async () => {
      const prev = tabRef.current;
      const t = await refreshTab();
      if (selectingRef.current && prev && t && prev.id !== t.id) {
        nav.stopSelection(prev.id);
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

  const addCapture = useCallback(
    (fieldId, payload) => {
      const p = projectRef.current;
      const field = p && p.fields.find((f) => f.id === fieldId);
      if (!field || !payload) return;
      const index = currentIndexRef.current;
      const rowIndex = productsRef.current[index]?.rowIndex;
      const listTag = field.kind === 'html' && (field.captureAs === 'ul' || field.captureAs === 'ol') ? field.captureAs : null;
      setFieldData(index, fieldId, (prev) => {
        const list = Array.isArray(prev) ? prev : [];
        let item;
        if (listTag && payload.html != null) {
          // "Clicks become one list": every capture adds <li> items to the same list.
          const cleaned = cleanCapturedHtml(payload.html, payload.sourceTag);
          const content = renderSelection({ html: cleaned.html, outputTag: cleaned.outputTag });
          const target = listTargetRef.current;
          const existing =
            target && target.fieldId === fieldId && target.rowIndex === rowIndex && target.tag === listTag
              ? list.find((i) => i.id === target.itemId)
              : null;
          if (existing) {
            const html = appendToList(renderSelection(existing), content, listTag);
            return list.map((i) => (i.id === existing.id ? { ...i, html, outputTag: 'keep', text: htmlToText(html) } : i));
          }
          const html = buildList(listTag, listItemsOf(content));
          item = { id: uid('s_'), html, text: htmlToText(html), sourceTag: listTag, outputTag: 'keep' };
          listTargetRef.current = { fieldId, itemId: item.id, rowIndex, tag: listTag };
          return field.multiple ? [...list, item] : [item];
        }
        if (field.kind === 'image') {
          if (list.some((i) => i.url === payload.url)) return list;
          item = { id: uid('i_'), url: payload.url };
        } else {
          const cleaned = cleanCapturedHtml(payload.html, payload.sourceTag);
          item = {
            id: uid('s_'),
            html: cleaned.html,
            text: payload.text || cleaned.text,
            sourceTag: cleaned.sourceTag,
            outputTag: cleaned.outputTag,
          };
        }
        return field.multiple ? [...list, item] : [item];
      });
    },
    [setFieldData],
  );

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return undefined;
    const listener = (msg, sender) => {
      if (!msg || !sender.tab) return;
      const cur = tabRef.current;
      if (cur && sender.tab.id !== cur.id) return;
      if (msg.type === 'pcc:captured') addCapture(msg.fieldId, msg.payload);
      else if (msg.type === 'pcc:stopped') setSelecting((s) => (s === msg.fieldId ? null : s));
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [addCapture]);

  const toggleSelect = useCallback(
    async (field) => {
      try {
        const t = await refreshTab();
        if (!t) throw new Error('No browser tab found.');
        if (selectingRef.current === field.id) {
          await nav.stopSelection(t.id);
          setSelecting(null);
          return;
        }
        listTargetRef.current = null;
        await nav.startSelection(t, field);
        setSelecting(field.id);
        notify(null);
      } catch (err) {
        setSelecting(null);
        showError(err);
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
        const t = await refreshTab();
        if (!t) throw new Error('No browser tab found to open the product in.');
        await nav.openUrl(t.id, product.url);
      } catch (err) {
        showError(err);
      }
    },
    [refreshTab, notify, showError],
  );

  const goTo = useCallback(
    async (index, { open = true, statusForCurrent } = {}) => {
      const list = productsRef.current;
      if (!list.length) return;
      const from = currentIndexRef.current;
      if (statusForCurrent) updateProduct(from, (p) => ({ ...p, status: statusForCurrent }));
      const target = Math.max(0, Math.min(index, list.length - 1));
      if (selectingRef.current && tabRef.current) {
        await nav.stopSelection(tabRef.current.id);
        setSelecting(null);
      }
      updateProject({ currentIndex: target });
      currentIndexRef.current = target;
      updateProduct(target, (p) => (p.status === 'pending' ? { ...p, status: 'in_progress' } : p));
      await saver.flush();
      if (open) await openInTab(list[target]);
    },
    [updateProduct, updateProject, saver, openInTab],
  );

  const completeCurrent = useCallback(
    async (andNext) => {
      const p = productsRef.current[currentIndexRef.current];
      const missing = missingRequired(projectRef.current, p);
      if (missing.length) {
        notify('error', `Required field(s) empty: ${missing.join(', ')}.`);
        return;
      }
      if (andNext && currentIndexRef.current < productsRef.current.length - 1) {
        await goTo(currentIndexRef.current + 1, { statusForCurrent: 'completed' });
      } else {
        updateProduct(currentIndexRef.current, (x) => ({ ...x, status: 'completed' }));
        await saver.flush();
        notify('success', 'Product marked as completed.');
      }
    },
    [goTo, updateProduct, saver, notify],
  );

  /** Changes one field's configuration (used for the capture mode in the Collect tab). */
  const updateField = useCallback(
    async (fieldId, patch) => {
      updateProject((p) => ({ ...p, fields: p.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)) }));
      listTargetRef.current = null;
      if (selectingRef.current === fieldId && tabRef.current) {
        const field = projectRef.current.fields.find((f) => f.id === fieldId);
        try {
          await nav.startSelection(tabRef.current, field);
        } catch {
          /* page gone: selection re-arms after load */
        }
      }
    },
    [updateProject],
  );

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
            {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : 'Saved'}
          </span>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              className={view === t.id ? 'active' : ''}
              aria-selected={view === t.id}
              disabled={t.needsProject && !project}
              onClick={() => setView(t.id)}
              data-testid={`tab-${t.id}`}
            >
              {t.label}
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
