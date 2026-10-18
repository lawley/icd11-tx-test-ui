import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearCache, DEFAULT_SOURCE, loadSuites, type SuiteDef, type TestDef, type TestSource } from './lib/tests';
import { clearVersionCache, runTest, type RunResult } from './lib/runner';
import { loadServers, saveServers, type ServerConfig } from './lib/servers';
import { Sidebar } from './components/Sidebar';
import { TestView } from './components/TestView';
import { SuiteMatrix } from './components/SuiteMatrix';
import { Settings } from './components/Settings';

export type Results = Record<string, Record<string, RunResult | 'running'>>;
export const resultKey = (suite: string, test: string) => `${suite}/${test}`;

const SOURCE_KEY = 'icd11-tx-ui.source.v1';
const PROXY_KEY = 'icd11-tx-ui.proxy.v1';

function loadSource(): TestSource {
  try {
    const s = localStorage.getItem(SOURCE_KEY);
    if (s) return JSON.parse(s) as TestSource;
  } catch {
    /* ignore */
  }
  return DEFAULT_SOURCE;
}

function readHash(): { suite?: string; test?: string } {
  const [suite, test] = decodeURIComponent(location.hash.slice(1)).split('/');
  return { suite: suite || undefined, test: test || undefined };
}

export function App() {
  const [source, setSource] = useState<TestSource>(loadSource);
  const [servers, setServers] = useState<ServerConfig[]>(loadServers);
  const [useProxy, setUseProxy] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PROXY_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const [suites, setSuites] = useState<SuiteDef[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [suiteName, setSuiteName] = useState<string>(() => readHash().suite ?? 'icd-11');
  const [testName, setTestName] = useState<string | undefined>(() => readHash().test);
  const [results, setResults] = useState<Results>({});
  const [showSettings, setShowSettings] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);

  const enabledServers = useMemo(() => servers.filter((s) => s.enabled), [servers]);

  useEffect(() => {
    let cancelled = false;
    setSuites(null);
    setLoadError(null);
    loadSuites(source)
      .then((s) => !cancelled && setSuites(s))
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    const h = `${suiteName}${testName ? `/${testName}` : ''}`;
    if (decodeURIComponent(location.hash.slice(1)) !== h) history.replaceState(null, '', `#${h}`);
  }, [suiteName, testName]);

  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      if (h.suite) setSuiteName(h.suite);
      setTestName(h.test);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const suite = suites?.find((s) => s.name === suiteName);
  const test = suite?.tests.find((t) => t.name === testName);

  const setResult = useCallback((key: string, serverId: string, r: RunResult | 'running') => {
    setResults((prev) => ({ ...prev, [key]: { ...prev[key], [serverId]: r } }));
  }, []);

  const runOne = useCallback(
    async (s: SuiteDef, t: TestDef, signal?: AbortSignal) => {
      const key = resultKey(s.name, t.name);
      await Promise.all(
        enabledServers.map(async (srv) => {
          setResult(key, srv.id, 'running');
          const r = await runTest(s, t, srv, { source, useProxy, signal });
          setResult(key, srv.id, r);
        }),
      );
    },
    [enabledServers, source, useProxy, setResult],
  );

  const runSuite = useCallback(async () => {
    if (!suite) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBatchRunning(true);
    const queue = [...suite.tests];
    const worker = async () => {
      while (queue.length && !ac.signal.aborted) {
        const t = queue.shift()!;
        await runOne(suite, t, ac.signal);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    setBatchRunning(false);
  }, [suite, runOne]);

  const stop = () => {
    abortRef.current?.abort();
    setBatchRunning(false);
  };

  const updateServers = (s: ServerConfig[]) => {
    setServers(s);
    saveServers(s);
    clearVersionCache();
  };
  const updateSource = (s: TestSource) => {
    try {
      localStorage.setItem(SOURCE_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
    clearCache();
    setSource(s);
  };
  const updateProxy = (v: boolean) => {
    try {
      localStorage.setItem(PROXY_KEY, String(v));
    } catch {
      /* ignore */
    }
    clearVersionCache();
    setUseProxy(v);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>TX Ecosystem Test Compare</strong>
          <span className="muted">
            {source.repo}@{source.ref}
          </span>
        </div>
        <div className="topbar-actions">
          <span className="muted small">
            {enabledServers.length} servers · {useProxy ? 'via dev proxy' : 'direct'}
          </span>
          <button onClick={() => setShowSettings(true)}>Settings</button>
        </div>
      </header>
      {loadError && <div className="banner error">Failed to load test-cases.json: {loadError}</div>}
      <div className="body">
        <Sidebar
          suites={suites}
          suiteName={suiteName}
          onSuite={(n) => {
            setSuiteName(n);
            setTestName(undefined);
          }}
          testName={testName}
          onTest={setTestName}
          results={results}
          servers={enabledServers}
          source={source}
        />
        <main className="main">
          {!suites && !loadError && <div className="empty">Loading test cases…</div>}
          {suite && !test && (
            <SuiteMatrix
              suite={suite}
              servers={enabledServers}
              results={results}
              running={batchRunning}
              onRun={runSuite}
              onStop={stop}
              onOpen={setTestName}
            />
          )}
          {suite && test && (
            <TestView
              key={resultKey(suite.name, test.name)}
              suite={suite}
              test={test}
              source={source}
              servers={enabledServers}
              results={results[resultKey(suite.name, test.name)] ?? {}}
              onRun={() => runOne(suite, test)}
            />
          )}
        </main>
      </div>
      {showSettings && (
        <Settings
          servers={servers}
          source={source}
          useProxy={useProxy}
          onClose={() => setShowSettings(false)}
          onServers={updateServers}
          onSource={updateSource}
          onProxy={updateProxy}
        />
      )}
    </div>
  );
}
