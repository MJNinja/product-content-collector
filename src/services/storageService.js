import { uid } from '../utils/id.js';
import { bytesToBase64, base64ToBytes } from './excelService.js';

/*
 * IndexedDB layout (database "product-content-collector"):
 *   projects  keyPath id                       project settings, columns, fields
 *   products  keyPath [projectId, rowIndex]    per-product data, index "byProject"
 *   workbooks keyPath projectId                original workbook bytes
 */

const DB_NAME = 'product-content-collector';
const DB_VERSION = 1;
export const BACKUP_FORMAT = 'product-content-collector-backup';

let dbPromise = null;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('products')) {
        const s = db.createObjectStore('products', { keyPath: ['projectId', 'rowIndex'] });
        s.createIndex('byProject', 'projectId');
      }
      if (!db.objectStoreNames.contains('workbooks')) db.createObjectStore('workbooks', { keyPath: 'projectId' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => {
      dbPromise = null;
      reject(r.error);
    };
  });
  return dbPromise;
}

/** For tests: forget the cached connection. */
export async function closeDb() {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

export function newProject(name) {
  const now = Date.now();
  return {
    id: uid('p_'),
    name: name || 'Untitled project',
    createdAt: now,
    updatedAt: now,
    fileName: null,
    sheetName: null,
    headerRow: 0,
    columns: [],
    urlColumnKey: null,
    fields: [],
    columnFormats: {},
    currentIndex: 0,
  };
}

export async function listProjects() {
  const db = await openDb();
  const tx = db.transaction(['projects', 'products'], 'readonly');
  const projects = await req(tx.objectStore('projects').getAll());
  const products = tx.objectStore('products');
  const result = [];
  for (const p of projects) {
    const list = await req(products.index('byProject').getAll(p.id));
    const counts = { total: list.length, pending: 0, in_progress: 0, completed: 0, skipped: 0 };
    for (const x of list) counts[x.status] = (counts[x.status] || 0) + 1;
    result.push({ ...p, counts });
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id) {
  const db = await openDb();
  return req(db.transaction('projects').objectStore('projects').get(id));
}

export async function saveProject(project) {
  const db = await openDb();
  const tx = db.transaction('projects', 'readwrite');
  const p = { ...project, updatedAt: Date.now() };
  delete p.counts;
  tx.objectStore('projects').put(p);
  await done(tx);
  return p;
}

export async function deleteProject(id) {
  const db = await openDb();
  const tx = db.transaction(['projects', 'products', 'workbooks'], 'readwrite');
  tx.objectStore('projects').delete(id);
  tx.objectStore('workbooks').delete(id);
  const store = tx.objectStore('products');
  const keys = await req(store.index('byProject').getAllKeys(id));
  for (const k of keys) store.delete(k);
  await done(tx);
}

export async function getProducts(projectId) {
  const db = await openDb();
  const list = await req(db.transaction('products').objectStore('products').index('byProject').getAll(projectId));
  return list.sort((a, b) => a.position - b.position);
}

export async function saveProduct(product) {
  const db = await openDb();
  const tx = db.transaction('products', 'readwrite');
  tx.objectStore('products').put({ ...product, updatedAt: Date.now() });
  await done(tx);
}

/** Replaces all products of a project. */
export async function replaceProducts(projectId, products) {
  const db = await openDb();
  const tx = db.transaction('products', 'readwrite');
  const store = tx.objectStore('products');
  const keys = await req(store.index('byProject').getAllKeys(projectId));
  for (const k of keys) store.delete(k);
  for (const p of products) store.put({ ...p, projectId });
  await done(tx);
}

export async function saveWorkbook(projectId, bytes, fileName) {
  const db = await openDb();
  const tx = db.transaction('workbooks', 'readwrite');
  tx.objectStore('workbooks').put({ projectId, bytes: new Uint8Array(bytes), fileName, savedAt: Date.now() });
  await done(tx);
}

export async function getWorkbook(projectId) {
  const db = await openDb();
  const rec = await req(db.transaction('workbooks').objectStore('workbooks').get(projectId));
  if (!rec) return null;
  return { ...rec, bytes: new Uint8Array(rec.bytes) };
}

export async function exportBackup(projectId) {
  const project = await getProject(projectId);
  if (!project) throw new Error('Project not found.');
  const products = await getProducts(projectId);
  const wb = await getWorkbook(projectId);
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
    products,
    workbook: wb ? { fileName: wb.fileName, base64: bytesToBase64(wb.bytes) } : null,
  };
}

/**
 * Restores a backup. If a project with the same id exists it is restored as a
 * new copy (never silently overwriting). Returns the restored project.
 */
export async function importBackup(backup) {
  if (!backup || backup.format !== BACKUP_FORMAT || !backup.project) {
    throw new Error('This file is not a Product Content Collector backup.');
  }
  const existing = await getProject(backup.project.id);
  const project = { ...backup.project };
  if (existing) {
    project.id = uid('p_');
    project.name = `${project.name} (restored)`;
  }
  await saveProject(project);
  await replaceProducts(project.id, (backup.products || []).map((p) => ({ ...p, projectId: project.id })));
  if (backup.workbook && backup.workbook.base64) {
    await saveWorkbook(project.id, base64ToBytes(backup.workbook.base64), backup.workbook.fileName);
  }
  return getProject(project.id);
}
