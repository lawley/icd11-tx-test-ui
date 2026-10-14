import { useState } from 'react';
import type { SuiteDef } from '../lib/tests';
import type { ServerConfig } from '../lib/servers';
import { resultKey, type Results } from '../App';
import { StatusDot } from './common';

interface Props {
  suites: SuiteDef[] | null;
  suiteName: string;
  onSuite: (n: string) => void;
  testName?: string;
  onTest: (n: string | undefined) => void;
  results: Results;
  servers: ServerConfig[];
}

export function Sidebar({ suites, suiteName, onSuite, testName, onTest, results, servers }: Props) {
  const [filter, setFilter] = useState('');
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
      <ul className="test-list">
        {tests.map((t) => {
          const r = results[resultKey(suiteName, t.name)] ?? {};
          return (
            <li key={t.name}>
              <button className={t.name === testName ? 'active' : ''} onClick={() => onTest(t.name)} title={t.description}>
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
    </aside>
  );
}
