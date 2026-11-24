import { useCallback, useEffect, useRef, useState } from 'react';
import * as storage from '../../services/storageService.js';
import { ConfirmButton, ProgressBar, downloadBytes, safeFileName } from './common.jsx';

export default function ProjectsView({ ctx }) {
  const { project, openProject, closeProject, notify, showError, saver } = ctx;
  const [projects, setProjects] = useState(null);
  const [name, setName] = useState('');
  const restoreRef = useRef(null);

  const load = useCallback(async () => {
    try {
      await saver.flush();
      setProjects(await storage.listProjects());
    } catch (err) {
      showError(err);
    }
  }, [saver, showError]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e) {
    e.preventDefault();
    const n = name.trim();
    if (!n) {
      notify('error', 'Enter a project name.');
      return;
    }
    try {
      const p = storage.newProject(n);
      await storage.saveProject(p);
      setName('');
      await openProject(p.id, 'import');
    } catch (err) {
      showError(err);
    }
  }

  async function remove(id) {
    try {
      if (project && project.id === id) await closeProject();
      await storage.deleteProject(id);
      notify('success', 'Project deleted.');
      load();
    } catch (err) {
      showError(err);
    }
  }

  async function backup(p) {
    try {
      await saver.flush();
      const data = await storage.exportBackup(p.id);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBytes(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${safeFileName(p.name)}-backup-${stamp}.json`);
      notify('success', 'Backup downloaded.');
    } catch (err) {
      showError(err);
    }
  }

  async function restore(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error('The selected file is not valid JSON.');
      }
      const p = await storage.importBackup(data);
      notify('success', `Project "${p.name}" restored.`);
      await load();
    } catch (err) {
      showError(err);
    }
  }

  return (
    <div className="view projects-view">
      <section className="card">
        <h2>New project</h2>
        <form className="row" onSubmit={create}>
          <input
            className="grow"
            placeholder="Project name, e.g. Client A – TVs"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="new-project-name"
          />
          <button className="btn primary" type="submit" data-testid="create-project">Create</button>
        </form>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Projects</h2>
          <button className="btn small" onClick={() => restoreRef.current.click()} data-testid="restore-backup">Restore backup…</button>
          <input ref={restoreRef} type="file" accept=".json,application/json" hidden onChange={restore} data-testid="restore-input" />
        </div>
        {projects === null && <p className="muted">Loading…</p>}
        {projects && !projects.length && <p className="muted">No projects yet. Create one above to get started.</p>}
        <ul className="project-list">
          {projects &&
            projects.map((p) => (
              <li key={p.id} className={project && project.id === p.id ? 'current' : ''} data-testid="project-item">
                <div className="project-main">
                  <div className="project-name">{p.name}</div>
                  <div className="muted small">
                    {p.fileName ? `${p.fileName} · ${p.sheetName}` : 'No workbook imported'} · {p.counts.total} products ·{' '}
                    {p.counts.completed} completed · {p.counts.skipped} skipped
                  </div>
                  <ProgressBar counts={p.counts} />
                </div>
                <div className="row wrap">
                  <button className="btn primary small" onClick={() => openProject(p.id)} data-testid="open-project">Open</button>
                  <button className="btn small" onClick={() => backup(p)} data-testid="backup-project">Backup</button>
                  <ConfirmButton className="btn small danger-outline" confirmText="Delete permanently?" onConfirm={() => remove(p.id)} testId="delete-project">
                    Delete
                  </ConfirmButton>
                </div>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
