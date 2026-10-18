import { useEffect, useState } from 'react';
import type { Json } from '../lib/compare';
import { compactRequest } from '../lib/compact';
import { OP_PATHS } from '../lib/runner';
import { fetchJson, type SuiteDef, type TestDef, type TestSource } from '../lib/tests';

interface Props {
  suite: SuiteDef;
  test: TestDef;
  source: TestSource;
  /** Viewport y of the hovered row's top edge. */
  top: number;
  left: number;
}

const OPTIONS = ['http-code', 'Accept-Language', 'lenient-display', 'profile', 'mode', 'modes', 'version'] as const;

/** Hover card: description, options and the raw request file in compact form. */
export function TestPreview({ suite, test, source, top, left }: Props) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string>();
  const req = test.request;

  useEffect(() => {
    setLines(null);
    setError(undefined);
    if (!req) return;
    let live = true;
    fetchJson<Json>(source, req)
      .then((b) => live && setLines(compactRequest(b)))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [source, req]);

  const op = test.operation;
  const target = op === 'metadata' ? 'GET metadata' : op === 'term-caps' ? 'GET metadata?mode=terminology' : `POST ${OP_PATHS[op] ?? op}`;
  const alts = Object.keys(test).filter((k) => k.startsWith('request:'));
  const opts = OPTIONS.filter((k) => test[k] != null).map((k) => `${k}: ${String(test[k])}`);
  if (test.header) opts.push(`header: ${test.header.name}: ${test.header.value}${test.header.mode ? ` (${test.header.mode})` : ''}`);
  const setup = op === 'metadata' || op === 'term-caps' ? 0 : suite.setup?.length ?? 0;

  return (
    <div className="test-preview" style={{ top: Math.max(8, Math.min(top, window.innerHeight - 260)), left }} role="tooltip">
      <div className="tp-name">{test.name}</div>
      {test.description && <p className="tp-desc">{test.description}</p>}
      {opts.length > 0 && <div className="tp-opts">{opts.join(' · ')}</div>}
      <pre className="tp-req">
        <span className="tp-target">{target}</span>
        {req && !lines && !error && '\n…'}
        {error && `\n${error}`}
        {lines?.map((l) => `\n  ${l}`).join('')}
        {setup > 0 && <span className="muted">{`\n  + ${setup} setup tx-resource${setup === 1 ? '' : 's'}`}</span>}
      </pre>
      {alts.length > 0 && <div className="tp-opts">alternatives: {alts.join(', ')}</div>}
    </div>
  );
}
