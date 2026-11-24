import { useEffect, useState } from 'react';

export function Banner({ message, onClose }) {
  useEffect(() => {
    if (message.type === 'error') return undefined;
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [message, onClose]);
  return (
    <div className={`banner ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'} data-testid="banner">
      <span>{message.text}</span>
      <button className="icon-btn" onClick={onClose} aria-label="Dismiss">×</button>
    </div>
  );
}

/** Button that asks for an inline confirmation before running a destructive action. */
export function ConfirmButton({ children, confirmText = 'Are you sure?', onConfirm, className = 'btn', testId }) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <span className="confirm" data-testid={testId ? `${testId}-confirm` : undefined}>
        <span>{confirmText}</span>
        <button className="btn danger small" onClick={() => { setAsking(false); onConfirm(); }} data-testid={testId ? `${testId}-yes` : undefined}>Yes</button>
        <button className="btn small" onClick={() => setAsking(false)}>Cancel</button>
      </span>
    );
  }
  return <button className={className} onClick={() => setAsking(true)} data-testid={testId}>{children}</button>;
}

export const STATUS_LABELS = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  skipped: 'Skipped',
};

export function StatusBadge({ status }) {
  return <span className={`status ${status}`} data-testid="status-badge">{STATUS_LABELS[status] || status}</span>;
}

export function ProgressBar({ counts }) {
  const total = counts.total || 0;
  const pct = (n) => (total ? `${(n / total) * 100}%` : '0%');
  return (
    <div className="progress" title={`${counts.completed || 0} completed, ${counts.skipped || 0} skipped of ${total}`}>
      <span className="seg completed" style={{ width: pct(counts.completed || 0) }} />
      <span className="seg skipped" style={{ width: pct(counts.skipped || 0) }} />
      <span className="seg in_progress" style={{ width: pct(counts.in_progress || 0) }} />
    </div>
  );
}

export function countStatuses(products) {
  const c = { total: products.length, pending: 0, in_progress: 0, completed: 0, skipped: 0 };
  for (const p of products) c[p.status] = (c[p.status] || 0) + 1;
  return c;
}

export function downloadBytes(bytes, fileName, mime) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function readFile(file, as = 'arrayBuffer') {
  return as === 'text' ? file.text() : file.arrayBuffer();
}

export function safeFileName(name) {
  return String(name || 'export').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'export';
}

function readCollapsed(id, fallback) {
  try {
    const v = localStorage.getItem(`pcc:collapsed:${id}`);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

/** Card with a clickable header that collapses its content. The open/closed state is remembered per section; until then `defaultCollapsed` applies. */
export function CollapsibleCard({ id, title, summary, actions, children, testId, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(id, defaultCollapsed));
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(`pcc:collapsed:${id}`, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  return (
    <section className={`card collapsible ${collapsed ? 'collapsed' : ''}`} data-testid={testId}>
      <div className="card-head">
        <button
          type="button"
          className="collapse-toggle"
          onClick={toggle}
          aria-expanded={!collapsed}
          data-testid={testId ? `${testId}-toggle` : undefined}
        >
          <span className="chevron" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
          <h2>{title}</h2>
          {collapsed && summary && <span className="muted small collapse-summary">{summary}</span>}
        </button>
        {!collapsed && actions}
      </div>
      {!collapsed && children}
    </section>
  );
}
