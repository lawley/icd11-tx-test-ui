import type { SuiteDef } from '../lib/tests';
import type { ServerConfig } from '../lib/servers';
import type { RunResult } from '../lib/runner';
import { resultKey, type Results } from '../App';
import { StatusDot } from './common';

interface Props {
  suite: SuiteDef;
  servers: ServerConfig[];
  results: Results;
  running: boolean;
  onRun: () => void;
  onStop: () => void;
  onOpen: (test: string) => void;
}

export function SuiteMatrix({ suite, servers, results, running, onRun, onStop, onOpen }: Props) {
  const tally = servers.map((s) => {
    const c = { pass: 0, fail: 0, error: 0, skipped: 0 };
    for (const t of suite.tests) {
      const r = results[resultKey(suite.name, t.name)]?.[s.id];
      if (r && r !== 'running') c[r.outcome]++;
    }
    return c;
  });
  return (
    <div className="matrix-view">
      <div className="view-head">
        <div>
          <h1>{suite.name}</h1>
          {suite.description && <p className="desc">{suite.description}</p>}
          {suite.setup?.length ? (
            <p className="muted small">Setup resources sent as tx-resource: {suite.setup.join(', ')}</p>
          ) : null}
        </div>
        <div className="actions">
          {running ? (
            <button onClick={onStop}>Stop</button>
          ) : (
            <button className="primary" onClick={onRun}>
              Run all {suite.tests.length} tests
            </button>
          )}
        </div>
      </div>
      <div className="table-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th>Test</th>
              <th>Op</th>
              {servers.map((s, i) => (
                <th key={s.id}>
                  <div>{s.name}</div>
                  <div className="muted small tally">
                    <span className="t-pass">{tally[i].pass}✓</span> <span className="t-fail">{tally[i].fail}✗</span>{' '}
                    {tally[i].error ? <span className="t-error">{tally[i].error}!</span> : null}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {suite.tests.map((t) => {
              const rs = results[resultKey(suite.name, t.name)] ?? {};
              return (
                <tr key={t.name} onClick={() => onOpen(t.name)}>
                  <td className="mono">{t.name}</td>
                  <td className="muted small">{t.operation}</td>
                  {servers.map((s) => (
                    <td key={s.id}>
                      <Cell r={rs[s.id]} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ r }: { r?: RunResult | 'running' }) {
  if (!r || r === 'running') return <StatusDot r={r} />;
  return (
    <span className="cell" title={r.message}>
      <StatusDot r={r} />
      <span className="muted small">
        {r.httpStatus ?? ''}
        {r.compare && !r.compare.pass ? ` · ${r.compare.diffs.length} diff${r.compare.diffs.length > 1 ? 's' : ''}` : ''}
      </span>
    </span>
  );
}
