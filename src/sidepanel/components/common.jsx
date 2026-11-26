import { useEffect, useState } from 'react';

/** Message bar at the top. Info and success messages disappear after 4 seconds; errors stay. */
export function Banner({ message, onClose }) {
  useEffect(() => {
    if (message.type === 'error') return undefined;
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
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
        <button
          className="btn danger small"
          onClick={() => {
            setAsking(false);
            onConfirm();
          }}
          data-testid={testId ? `${testId}-yes` : undefined}
        >
          Yes
        </button>
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

/** Coloured bar: completed, skipped and in-progress products as parts of the total. */
export function ProgressBar({ counts }) {
  const total = counts.total || 0;
  const widthFor = (count) => (total ? `${(count / total) * 100}%` : '0%');
  return (
    <div className="progress" title={`${counts.completed || 0} completed, ${counts.skipped || 0} skipped of ${total}`}>
      <span className="seg completed" style={{ width: widthFor(counts.completed || 0) }} />
      <span className="seg skipped" style={{ width: widthFor(counts.skipped || 0) }} />
      <span className="seg in_progress" style={{ width: widthFor(counts.in_progress || 0) }} />
    </div>
  );
}

/** Number of products per status, plus the total. */
export function countStatuses(products) {
  const counts = { total: products.length, pending: 0, in_progress: 0, completed: 0, skipped: 0 };
  for (const product of products) counts[product.status] = (counts[product.status] || 0) + 1;
  return counts;
}

/** Makes the browser download data as a file (through a temporary link). */
export function downloadBytes(bytes, fileName, mime) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
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
    const stored = localStorage.getItem(`pcc:collapsed:${id}`);
    return stored == null ? fallback : stored === '1';
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
