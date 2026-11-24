import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as storage from '../../src/services/storageService.js';
import { createAutosaver } from '../../src/utils/autosave.js';
import { makeWorkbook } from './helpers.js';

function products(projectId) {
  return [0, 1, 2].map((i) => ({ projectId, rowIndex: i + 1, position: i, url: `https://x.test/${i}`, status: 'pending', source: {}, data: {} }));
}

describe('project storage', () => {
  beforeEach(async () => {
    for (const p of await storage.listProjects()) await storage.deleteProject(p.id);
  });

  it('creates, lists, saves and deletes projects with their products and workbook', async () => {
    const p = storage.newProject('Client A');
    await storage.saveProject(p);
    await storage.replaceProducts(p.id, products(p.id));
    await storage.saveWorkbook(p.id, makeWorkbook({ S: [['a']] }), 'a.xlsx');
    const list = await storage.listProjects();
    expect(list).toHaveLength(1);
    expect(list[0].counts.total).toBe(3);
    expect((await storage.getWorkbook(p.id)).fileName).toBe('a.xlsx');

    await storage.deleteProject(p.id);
    expect(await storage.listProjects()).toHaveLength(0);
    expect(await storage.getProducts(p.id)).toHaveLength(0);
    expect(await storage.getWorkbook(p.id)).toBeNull();
  });

  it('projects are independent', async () => {
    const a = storage.newProject('A');
    const b = storage.newProject('B');
    await storage.saveProject(a);
    await storage.saveProject(b);
    await storage.replaceProducts(a.id, products(a.id));
    await storage.replaceProducts(b.id, products(b.id).slice(0, 1));
    const pa = await storage.getProducts(a.id);
    pa[0] = { ...pa[0], data: { cat: 'X' }, status: 'completed' };
    await storage.saveProduct(pa[0]);
    expect((await storage.getProducts(b.id))[0].data).toEqual({});
    expect((await storage.getProducts(a.id))[0]).toMatchObject({ data: { cat: 'X' }, status: 'completed' });
  });

  it('saving one product never changes another', async () => {
    const p = storage.newProject('Iso');
    await storage.saveProject(p);
    await storage.replaceProducts(p.id, products(p.id));
    const list = await storage.getProducts(p.id);
    await storage.saveProduct({ ...list[0], data: { main: 'Electronics, Entertainment', sub: 'Smart TVs, 4K TVs' } });
    await storage.saveProduct({ ...list[1], data: { main: 'Electronics', sub: 'Audio, Speakers' } });
    await storage.saveProduct({ ...list[2], data: { main: 'Appliances', sub: 'Refrigeration' } });
    const again = await storage.getProducts(p.id);
    expect(again.map((x) => x.data.main)).toEqual(['Electronics, Entertainment', 'Electronics', 'Appliances']);
    expect(again.map((x) => x.data.sub)).toEqual(['Smart TVs, 4K TVs', 'Audio, Speakers', 'Refrigeration']);
  });

  it('backup and restore round trip (restored as a copy when the original exists)', async () => {
    const p = { ...storage.newProject('Backup me'), fields: [{ id: 'f', label: 'F' }], columnFormats: { c2: { mode: 'path' } } };
    await storage.saveProject(p);
    const prods = products(p.id);
    prods[1].data = { f: 'value' };
    prods[1].status = 'completed';
    await storage.replaceProducts(p.id, prods);
    const wbBytes = makeWorkbook({ S: [['a'], ['b']] });
    await storage.saveWorkbook(p.id, wbBytes, 'b.xlsx');

    const backup = JSON.parse(JSON.stringify(await storage.exportBackup(p.id)));
    expect(backup.format).toBe(storage.BACKUP_FORMAT);

    const copy = await storage.importBackup(backup);
    expect(copy.id).not.toBe(p.id);
    expect(copy.name).toBe('Backup me (restored)');
    expect(copy.fields).toEqual(p.fields);
    expect(copy.columnFormats).toEqual(p.columnFormats);
    const cp = await storage.getProducts(copy.id);
    expect(cp[1]).toMatchObject({ data: { f: 'value' }, status: 'completed', projectId: copy.id });
    expect(Array.from((await storage.getWorkbook(copy.id)).bytes)).toEqual(Array.from(wbBytes));

    // Restoring after deletion keeps the original id/name.
    await storage.deleteProject(p.id);
    await storage.deleteProject(copy.id);
    const restored = await storage.importBackup(backup);
    expect(restored.id).toBe(p.id);
    expect(restored.name).toBe('Backup me');
  });

  it('rejects files that are not backups', async () => {
    await expect(storage.importBackup({ hello: 1 })).rejects.toThrow(/not a Product Content Collector backup/);
  });

  it('data survives a closed and reopened database (browser restart)', async () => {
    const p = storage.newProject('Persist');
    await storage.saveProject(p);
    await storage.replaceProducts(p.id, products(p.id));
    await storage.closeDb();
    expect((await storage.getProject(p.id)).name).toBe('Persist');
    expect(await storage.getProducts(p.id)).toHaveLength(3);
  });
});

describe('autosave', () => {
  it('debounces, keeps only the latest value per key and flushes on demand', async () => {
    vi.useFakeTimers();
    const saved = [];
    const s = createAutosaver(async (v) => saved.push(v), 300);
    s.schedule('a', 1);
    s.schedule('a', 2);
    s.schedule('b', 3);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(299);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(5);
    expect(saved.sort()).toEqual([2, 3]);
    s.schedule('a', 4);
    await s.flush();
    expect(saved).toContain(4);
    vi.useRealTimers();
  });

  it('autosaved products are persisted to IndexedDB', async () => {
    const p = storage.newProject('Auto');
    await storage.saveProject(p);
    await storage.replaceProducts(p.id, products(p.id));
    const s = createAutosaver((v) => storage.saveProduct(v), 50);
    const [first] = await storage.getProducts(p.id);
    s.schedule('x', { ...first, data: { cat: 'One' } });
    s.schedule('x', { ...first, data: { cat: 'Two' } });
    await s.flush();
    expect((await storage.getProducts(p.id))[0].data.cat).toBe('Two');
  });

  it('reports errors', async () => {
    const onError = vi.fn();
    const s = createAutosaver(async () => { throw new Error('disk full'); }, 10, onError);
    s.schedule('a', 1);
    await s.flush();
    expect(onError).toHaveBeenCalled();
  });
});
