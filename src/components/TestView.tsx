import { useEffect, useMemo, useState } from 'react';
import { chooseParam, fetchJson, githubUrl, type SuiteDef, type TestDef, type TestSource } from '../lib/tests';
import type { RunResult } from '../lib/runner';
import type { ServerConfig } from '../lib/servers';
import type { Json } from '../lib/compare';
import { CopyButton, JsonBlock, OutcomeBadge } from './common';
import { AlignedTable } from './AlignedTable';

interface Props {
  suite: SuiteDef;
  test: TestDef;
  source: TestSource;
  servers: ServerConfig[];
  results: Record<string, RunResult | 'running'>;
  onRun: () => void;
}

type Tab = 'compare' | 'diffs' | 'raw' | 'request';

export function TestView({ suite, test, source, servers, results, onRun }: Props) {
  const [tab, setTab] = useState<Tab>('compare');
  const [expected, setExpected] = useState<Json | undefined>();
  const [request, setRequest] = useState<Json | undefined>();
  const running = servers.some((s) => results[s.id] === 'running');
  const done = servers.map((s) => results[s.id]).filter((r): r is RunResult => !!r && r !== 'running');

  // Show expected/request before anything is run (base files, no mode alternatives)
  useEffect(() => {
    const noModes = new Set<string>();
    const resp = chooseParam(test, 'response', noModes);
    const req = chooseParam(test, 'request', noModes);
    if (resp) fetchJson(source, resp).then(setExpected, () => setExpected(undefined));
    if (req) fetchJson(source, req).then(setRequest, () => setRequest(undefined));
  }, [test, source]);

  const files = [
    ['request', chooseParam(test, 'request', new Set())],
    ['response', chooseParam(test, 'response', new Set())],
  ].filter((x): x is [string, string] => !!x[1]);
  const altKeys = Object.keys(test).filter((k) => /^(request|response):/.test(k));

  return (
    <div className="test-view">
      <div className="view-head">
        <div>
          <h1 className="mono">{test.name}</h1>
          <div className="meta-row">
            <span className="chip">{test.operation}</span>
            <span className="chip">HTTP {test['http-code'] ?? '2xx'}</span>
            {test['Accept-Language'] && <span className="chip">Accept-Language: {test['Accept-Language']}</span>}
            {test.mode && <span className="chip">mode {test.mode}</span>}
            {test.version && <span className="chip">FHIR {test.version}</span>}
            {altKeys.map((k) => (
              <span key={k} className="chip" title={String(test[k])}>
                {k}
              </span>
            ))}
            {files.map(([label, f]) => (
              <a key={f} className="chip link" href={githubUrl(source, f)} target="_blank" rel="noreferrer">
                {label}: {f}
              </a>
            ))}
          </div>
          {test.description && <p className="desc">{test.description}</p>}
        </div>
        <div className="actions">
          <button className="primary" onClick={onRun} disabled={running}>
            {running ? 'Running…' : done.length ? 'Re-run' : 'Run'}
          </button>
        </div>
      </div>

      <div className="server-cards">
        {servers.map((s) => {
          const r = results[s.id];
          const rr = r && r !== 'running' ? r : undefined;
          return (
            <div key={s.id} className={`server-card ${rr?.outcome ?? ''}`}>
              <div className="card-top">
                <strong>{s.name}</strong>
                <OutcomeBadge r={r} />
              </div>
              {rr && (
                <>
                  <div className="muted small">
                    {rr.httpStatus != null && (
                      <span className={rr.httpOk === false ? 't-fail' : ''}>
                        HTTP {rr.httpStatus} (want {rr.httpExpected})
                      </span>
                    )}
                    {rr.ms != null && <> · {rr.ms} ms</>}
                    {rr.fhirVersion && <> · FHIR {rr.fhirVersion}</>}
                  </div>
                  {rr.message && <div className="card-msg">{rr.message}</div>}
                  {rr.compare && !rr.compare.pass && (
                    <div className="muted small">{rr.compare.diffs.length} difference(s) from expected</div>
                  )}
                  {rr.compare?.warnings.map((w) => (
                    <div key={w} className="warn small">
                      ⚠ {w}
                    </div>
                  ))}
                </>
              )}
              <div className="muted small modes">modes: {s.modes.join(', ') || '—'}</div>
            </div>
          );
        })}
      </div>

      <nav className="tabs">
        {(
          [
            ['compare', 'Side by side'],
            ['diffs', 'Differences vs expected'],
            ['raw', 'Responses'],
            ['request', 'Request'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>

      <div className={`tab-panel tab-${tab}`}>
        {tab === 'compare' && <AlignedTable expected={expected} servers={servers} results={results} />}
        {tab === 'diffs' && <DiffList servers={servers} results={results} />}
        {tab === 'raw' && <RawView expected={expected} servers={servers} results={results} />}
        {tab === 'request' && <RequestView request={request} suite={suite} servers={servers} results={results} />}
      </div>
    </div>
  );
}

function DiffList({ servers, results }: { servers: ServerConfig[]; results: Props['results'] }) {
  return (
    <div className="diff-cols scroll">
      {servers.map((s) => {
        const r = results[s.id];
        return (
          <section key={s.id} className="diff-col">
            <h3>{s.name}</h3>
            {(!r || r === 'running') && <p className="muted">Not run yet.</p>}
            {r && r !== 'running' && r.outcome === 'skipped' && <p className="muted">Skipped: {r.message}</p>}
            {r && r !== 'running' && r.outcome === 'error' && <p className="t-error">{r.message}</p>}
            {r && r !== 'running' && r.httpOk === false && (
              <div className="diff">
                <div className="diff-msg">HTTP status {r.httpStatus}, expected {r.httpExpected}</div>
              </div>
            )}
            {r && r !== 'running' && r.compare?.pass && <p className="t-pass">Response matches expected.</p>}
            {r && r !== 'running' &&
              r.compare?.diffs.map((d, i) => (
                <div key={i} className="diff">
                  <div className="diff-path mono">{d.path || '(root)'}</div>
                  <div className="diff-msg">{d.message}</div>
                  {d.expected !== undefined && (
                    <div className="small">
                      <span className="muted">expected </span>
                      <code>{d.expected}</code>
                    </div>
                  )}
                  {d.actual !== undefined && (
                    <div className="small">
                      <span className="muted">actual </span>
                      <code>{d.actual}</code>
                    </div>
                  )}
                </div>
              ))}
          </section>
        );
      })}
    </div>
  );
}

function RawView({ expected, servers, results }: { expected?: Json; servers: ServerConfig[]; results: Props['results'] }) {
  const [mode, setMode] = useState<'normalised' | 'raw'>('normalised');
  return (
    <div className="fill">
      <div className="toolbar">
        <label>
          <input type="radio" checked={mode === 'normalised'} onChange={() => setMode('normalised')} /> Normalised (R5,
          scrubbed, sorted — what is compared)
        </label>
        <label>
          <input type="radio" checked={mode === 'raw'} onChange={() => setMode('raw')} /> As returned
        </label>
      </div>
      <div className="raw-cols" style={{ gridTemplateColumns: `repeat(${servers.length + 1}, minmax(300px, 1fr))` }}>
        <section>
          <h3>
            Expected <CopyButton text={JSON.stringify(expected, null, 2)} />
          </h3>
          <JsonBlock value={expected} />
        </section>
        {servers.map((s) => {
          const r = results[s.id];
          const v = r && r !== 'running' ? (mode === 'raw' ? (r.responseText ?? r.actual) : r.normalised) : undefined;
          const text = typeof v === 'string' ? prettyMaybe(v) : JSON.stringify(v, null, 2);
          return (
            <section key={s.id}>
              <h3>
                {s.name} {v !== undefined && <CopyButton text={text} />}
              </h3>
              {v === undefined ? <p className="muted">No response.</p> : <JsonBlock value={text} />}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function prettyMaybe(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function RequestView({
  request,
  suite,
  servers,
  results,
}: {
  request?: Json;
  suite: SuiteDef;
  servers: ServerConfig[];
  results: Props['results'];
}) {
  const sent = useMemo(() => servers.map((s) => [s, results[s.id]] as const), [servers, results]);
  return (
    <div className="scroll">
      <p className="muted small">
        The request file is sent with each of the suite's setup resources ({suite.setup?.length ?? 0}) appended as{' '}
        <code>tx-resource</code> parameters, as the Java runner does.
      </p>
      {sent.map(([s, r]) =>
        r && r !== 'running' && r.url ? (
          <div key={s.id} className="req-line mono small">
            <strong>{s.name}</strong>: {r.method} {r.url}
            {r.requestHeaders && (
              <span className="muted">
                {' '}
                {Object.entries(r.requestHeaders)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ')}
              </span>
            )}
          </div>
        ) : null,
      )}
      <h3>Request parameters (from test file)</h3>
      <JsonBlock value={request ?? '(none)'} />
    </div>
  );
}
