import { useEffect, useRef, useState } from 'react';
import type { SuiteDef, TestSource } from '../lib/tests';
import type { ServerConfig } from '../lib/servers';
import { resultKey, type Results } from '../App';
import { StatusDot } from './common';
import { TestPreview } from './TestPreview';

interface Props {
  suites: SuiteDef[] | null;
  suiteName: string;
  onSuite: (n: string) => void;
  testName?: string;
  onTest: (n: string | undefined) => void;
  results: Results;
  servers: ServerConfig[];
  source: TestSource;
}

export function Sidebar({ suites, suiteName, onSuite, testName, onTest, results, servers, source }: Props) {
  const [filter, setFilter] = useState('');
  const [hover, setHover] = useState<{ name: string; top: number; left: number }>();
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const showPreview = (name: string, el: HTMLElement) => {
    window.clearTimeout(timer.current);
    const r = el.getBoundingClientRect();
    timer.current = window.setTimeout(() => setHover({ name, top: r.top, left: r.right + 12 }), 350);
  };
  const hidePreview = () => {
    window.clearTimeout(timer.current);
    setHover(undefined);
  };
  const suite = suites?.find((s) => s.name === suiteName);
  const f = filter.trim().toLowerCase();
  const tests = (suite?.tests ?? []).filter(
    (t) => !f || t.name.toLowerCase().includes(f) || t.operation.includes(f) || t.description?.toLowerCase().includes(f),
  );
  return (
    <aside className="sidebar">
      <label className="field">
        <span>Suite</span>
        <select value={suiteName} onChange={(e) => onSuite(e.target.value)} disabled={!suites}>
          {suites?.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} ({s.tests.length})
            </option>
          ))}
          {!suites && <option>{suiteName}</option>}
        </select>
      </label>
      <input className="filter" placeholder="Filter tests…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <button className={`overview ${testName ? '' : 'active'}`} onClick={() => onTest(undefined)}>
        Suite overview
      </button>
      <ul className="test-list" onScroll={hidePreview}>
        {tests.map((t) => {
          const r = results[resultKey(suiteName, t.name)] ?? {};
          return (
            <li key={t.name}>
              <button className={t.name === testName ? 'active' : ''} onClick={() => onTest(t.name)}
                onMouseEnter={(e) => showPreview(t.name, e.currentTarget)}
                onMouseLeave={hidePreview}
              >
                <span className="test-name">{t.name}</span>
                <span className="op">{t.operation}</span>
                <span className="dots">
                  {servers.map((s) => (
                    <StatusDot key={s.id} r={r[s.id]} title={s.name} />
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {suite && hover && (() => {
        const t = suite.tests.find((x) => x.name === hover.name);
        return t && <TestPreview suite={suite} test={t} source={source} top={hover.top} left={hover.left} />;
      })()}
    </aside>
  );
}
