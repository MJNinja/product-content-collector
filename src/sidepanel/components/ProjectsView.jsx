import { useCallback, useEffect, useRef, useState } from 'react';
import * as storage from '../../services/storageService.js';
import { ConfirmButton, ProgressBar, downloadBytes, safeFileName } from './common.jsx';

/** Projects tab: create, open, delete, back up and restore projects. */
export default function ProjectsView({ ctx }) {
  const { project, openProject, closeProject, notify, showError, saver } = ctx;
  const [projects, setProjects] = useState(null);
  const [name, setName] = useState(''); // name typed for a new project
  const restoreRef = useRef(null);

  const load = useCallback(async () => {
    try {
      await saver.flush();
      setProjects(await storage.listProjects());
    } catch (error) {
      showError(error);
    }
  }, [saver, showError]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(event) {
    event.preventDefault();
    const projectName = name.trim();
    if (!projectName) {
      notify('error', 'Enter a project name.');
      return;
    }
    try {
      const newProject = storage.newProject(projectName);
      await storage.saveProject(newProject);
      setName('');
      await openProject(newProject.id, 'import');
    } catch (error) {
      showError(error);
    }
  }

  async function remove(id) {
    try {
      if (project && project.id === id) await closeProject();
      await storage.deleteProject(id);
      notify('success', 'Project deleted.');
      load();
    } catch (error) {
      showError(error);
    }
  }

  async function backup(projectToBackUp) {
    try {
      await saver.flush();
      const data = await storage.exportBackup(projectToBackUp.id);
      const date = new Date().toISOString().slice(0, 10); // e.g. 2026-11-26
      const json = new Blob([JSON.stringify(data)], { type: 'application/json' });
      downloadBytes(json, `${safeFileName(projectToBackUp.name)}-backup-${date}.json`);
      notify('success', 'Backup downloaded.');
    } catch (error) {
      showError(error);
    }
  }

  async function restore(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = ''; // so choosing the same file again triggers a change
    if (!file) return;
    try {
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error('The selected file is not valid JSON.');
      }
      const restored = await storage.importBackup(data);
      notify('success', `Project "${restored.name}" restored.`);
      await load();
    } catch (error) {
      showError(error);
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
            onChange={(event) => setName(event.target.value)}
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
            projects.map((item) => (
              <li key={item.id} className={project && project.id === item.id ? 'current' : ''} data-testid="project-item">
                <div className="project-main">
                  <div className="project-name">{item.name}</div>
                  <div className="muted small">
                    {item.fileName ? `${item.fileName} · ${item.sheetName}` : 'No workbook imported'} · {item.counts.total} products ·{' '}
                    {item.counts.completed} completed · {item.counts.skipped} skipped
                  </div>
                  <ProgressBar counts={item.counts} />
                </div>
                <div className="row wrap">
                  <button className="btn primary small" onClick={() => openProject(item.id)} data-testid="open-project">Open</button>
                  <button className="btn small" onClick={() => backup(item)} data-testid="backup-project">Backup</button>
                  <ConfirmButton className="btn small danger-outline" confirmText="Delete permanently?" onConfirm={() => remove(item.id)} testId="delete-project">
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
