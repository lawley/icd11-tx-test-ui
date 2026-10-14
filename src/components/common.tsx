import type { RunResult } from '../lib/runner';

export function StatusDot({ r, title }: { r?: RunResult | 'running'; title?: string }) {
  const cls = r === undefined ? 'none' : r === 'running' ? 'running' : r.outcome;
  const label = r === undefined ? 'not run' : r === 'running' ? 'running' : r.outcome;
  return <span className={`dot ${cls}`} title={title ? `${title}: ${label}` : label} />;
}

export function OutcomeBadge({ r }: { r?: RunResult | 'running' }) {
  if (r === undefined) return <span className="badge none">not run</span>;
  if (r === 'running') return <span className="badge running">running…</span>;
  return <span className={`badge ${r.outcome}`}>{r.outcome}</span>;
}

export function JsonBlock({ value, maxHeight }: { value: unknown; maxHeight?: number }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <pre className="json" style={maxHeight ? { maxHeight } : undefined}>
      {text ?? '—'}
    </pre>
  );
}

export function CopyButton({ text }: { text: string }) {
  return (
    <button className="small ghost" onClick={() => navigator.clipboard?.writeText(text)} title="Copy to clipboard">
      Copy
    </button>
  );
}
