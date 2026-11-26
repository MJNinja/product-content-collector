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

/*
 * IndexedDB uses callbacks (onsuccess / onerror). These two helpers turn them
 * into promises so the functions below can use async/await.
 */

/** Resolves with the result of one IndexedDB request. */
function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Resolves when a transaction has been written completely. */
function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    // Runs when the database is created or DB_VERSION goes up: creates the stores.
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('products')) {
        const productStore = db.createObjectStore('products', { keyPath: ['projectId', 'rowIndex'] });
        productStore.createIndex('byProject', 'projectId');
      }
      if (!db.objectStoreNames.contains('workbooks')) db.createObjectStore('workbooks', { keyPath: 'projectId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null; // allow a retry
      reject(request.error);
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
  const projects = await requestResult(tx.objectStore('projects').getAll());
  const productsByProject = tx.objectStore('products').index('byProject');
  const result = [];
  for (const project of projects) {
    const products = await requestResult(productsByProject.getAll(project.id));
    const counts = { total: products.length, pending: 0, in_progress: 0, completed: 0, skipped: 0 };
    for (const product of products) counts[product.status] = (counts[product.status] || 0) + 1;
    result.push({ ...project, counts });
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id) {
  const db = await openDb();
  return requestResult(db.transaction('projects').objectStore('projects').get(id));
}

export async function saveProject(project) {
  const db = await openDb();
  const tx = db.transaction('projects', 'readwrite');
  const saved = { ...project, updatedAt: Date.now() };
  delete saved.counts; // added by listProjects for display only
  tx.objectStore('projects').put(saved);
  await transactionDone(tx);
  return saved;
}

export async function deleteProject(id) {
  const db = await openDb();
  const tx = db.transaction(['projects', 'products', 'workbooks'], 'readwrite');
  tx.objectStore('projects').delete(id);
  tx.objectStore('workbooks').delete(id);
  const productStore = tx.objectStore('products');
  const productKeys = await requestResult(productStore.index('byProject').getAllKeys(id));
  for (const key of productKeys) productStore.delete(key);
  await transactionDone(tx);
}

export async function getProducts(projectId) {
  const db = await openDb();
  const productsByProject = db.transaction('products').objectStore('products').index('byProject');
  const products = await requestResult(productsByProject.getAll(projectId));
  return products.sort((a, b) => a.position - b.position);
}

export async function saveProduct(product) {
  const db = await openDb();
  const tx = db.transaction('products', 'readwrite');
  tx.objectStore('products').put({ ...product, updatedAt: Date.now() });
  await transactionDone(tx);
}

/** Replaces all products of a project. */
export async function replaceProducts(projectId, products) {
  const db = await openDb();
  const tx = db.transaction('products', 'readwrite');
  const productStore = tx.objectStore('products');
  const oldKeys = await requestResult(productStore.index('byProject').getAllKeys(projectId));
  for (const key of oldKeys) productStore.delete(key);
  for (const product of products) productStore.put({ ...product, projectId });
  await transactionDone(tx);
}

export async function saveWorkbook(projectId, bytes, fileName) {
  const db = await openDb();
  const tx = db.transaction('workbooks', 'readwrite');
  tx.objectStore('workbooks').put({ projectId, bytes: new Uint8Array(bytes), fileName, savedAt: Date.now() });
  await transactionDone(tx);
}

export async function getWorkbook(projectId) {
  const db = await openDb();
  const record = await requestResult(db.transaction('workbooks').objectStore('workbooks').get(projectId));
  if (!record) return null;
  return { ...record, bytes: new Uint8Array(record.bytes) };
}

/** Everything about a project (settings, products, workbook) as one JSON-ready object. */
export async function exportBackup(projectId) {
  const project = await getProject(projectId);
  if (!project) throw new Error('Project not found.');
  const products = await getProducts(projectId);
  const workbook = await getWorkbook(projectId);
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
    products,
    workbook: workbook ? { fileName: workbook.fileName, base64: bytesToBase64(workbook.bytes) } : null,
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
  const products = (backup.products || []).map((product) => ({ ...product, projectId: project.id }));
  await replaceProducts(project.id, products);
  if (backup.workbook && backup.workbook.base64) {
    await saveWorkbook(project.id, base64ToBytes(backup.workbook.base64), backup.workbook.fileName);
  }
  return getProject(project.id);
}
