import { useState } from 'react';
import { formatHtmlSource, safeHtml } from '../../services/htmlService.js';

/** Rendered / source view of combined HTML. Content is sanitised again before rendering. */
export default function HtmlPreview({ html, title = 'HTML preview', defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [mode, setMode] = useState('rendered');
  return (
    <div className="html-preview" data-testid="html-preview">
      <button className="link-btn" onClick={() => setOpen(!open)} data-testid="preview-toggle">
        {open ? '▾' : '▸'} {title}
      </button>
      {open && (
        <>
          <div className="seg-control">
            <button className={mode === 'rendered' ? 'active' : ''} onClick={() => setMode('rendered')}>Rendered</button>
            <button className={mode === 'source' ? 'active' : ''} onClick={() => setMode('source')} data-testid="preview-source">Source</button>
          </div>
          {mode === 'rendered' ? (
            // eslint-disable-next-line react/no-danger
            <div className="rendered" data-testid="preview-rendered" dangerouslySetInnerHTML={{ __html: safeHtml(html) }} />
          ) : (
            <pre className="source" data-testid="preview-source-code">{formatHtmlSource(html)}</pre>
          )}
        </>
      )}
    </div>
  );
}
