import { useState } from 'react';
import { DEFAULT_SERVERS, type ServerConfig } from '../lib/servers';
import { DEFAULT_SOURCE, type TestSource } from '../lib/tests';

interface Props {
  servers: ServerConfig[];
  source: TestSource;
  useProxy: boolean;
  onClose: () => void;
  onServers: (s: ServerConfig[]) => void;
  onSource: (s: TestSource) => void;
  onProxy: (v: boolean) => void;
}

export function Settings({ servers, source, useProxy, onClose, onServers, onSource, onProxy }: Props) {
  const [draft, setDraft] = useState<ServerConfig[]>(servers);
  const [src, setSrc] = useState<TestSource>(source);
  const [proxy, setProxy] = useState(useProxy);

  const update = (i: number, patch: Partial<ServerConfig>) => setDraft(draft.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const save = () => {
    onServers(draft.filter((s) => s.base.trim()));
    if (src.repo !== source.repo || src.ref !== source.ref) onSource(src);
    if (proxy !== useProxy) onProxy(proxy);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <h3>Servers</h3>
        <p className="muted small">
          Modes are the runner modes for that server (as <code>-mode</code> on the Java runner): they gate suites/tests and
          drive <code>$optional$</code>/<code>$only$</code>. Externals is an optional messages file under <code>tests/</code>{' '}
          (keyed by response file) used for <code>$external:N$</code>.
        </p>
        <table className="settings-table">
          <thead>
            <tr>
              <th>On</th>
              <th>Name</th>
              <th>Base URL</th>
              <th>Modes</th>
              <th>Externals</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {draft.map((s, i) => (
              <tr key={s.id}>
                <td>
                  <input type="checkbox" checked={s.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
                </td>
                <td>
                  <input value={s.name} onChange={(e) => update(i, { name: e.target.value })} />
                </td>
                <td>
                  <input className="wide" value={s.base} onChange={(e) => update(i, { base: e.target.value })} />
                </td>
                <td>
                  <input
                    value={s.modes.join(', ')}
                    onChange={(e) =>
                      update(i, {
                        modes: e.target.value
                          .split(',')
                          .map((m) => m.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </td>
                <td>
                  <input value={s.externals ?? ''} onChange={(e) => update(i, { externals: e.target.value.trim() || undefined })} />
                </td>
                <td>
                  <button className="small ghost" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <button
            onClick={() =>
              setDraft([...draft, { id: `srv-${Date.now()}`, name: 'New server', base: '', modes: ['icd-11'], enabled: true }])
            }
          >
            Add server
          </button>
          <button className="ghost" onClick={() => setDraft(DEFAULT_SERVERS)}>
            Reset to defaults
          </button>
        </div>

        <h3>Test source</h3>
        <div className="row">
          <label className="field">
            <span>GitHub repo</span>
            <input value={src.repo} onChange={(e) => setSrc({ ...src, repo: e.target.value.trim() })} />
          </label>
          <label className="field">
            <span>Ref (branch / tag / sha)</span>
            <input value={src.ref} onChange={(e) => setSrc({ ...src, ref: e.target.value.trim() })} />
          </label>
          <button className="ghost" onClick={() => setSrc(DEFAULT_SOURCE)}>
            Default
          </button>
        </div>

        <h3>Network</h3>
        <label className="row">
          <input type="checkbox" checked={proxy} onChange={(e) => setProxy(e.target.checked)} />
          <span>
            Send requests through the Vite dev/preview proxy (avoids CORS and http mixed-content; sends no Accept-Language
            unless the test sets one, matching the Java runner). Direct mode works only for servers allowing CORS, and the
            browser's own Accept-Language is always sent.
          </span>
        </label>

        <div className="row end">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
