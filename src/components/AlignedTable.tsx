import { useMemo, useState } from 'react';
import { align, prettyKey, type CellStatus } from '../lib/align';
import { describeTemplate, isTemplate, type Json } from '../lib/compare';
import type { RunResult } from '../lib/runner';
import type { ServerConfig } from '../lib/servers';

interface Props {
  expected?: Json;
  servers: ServerConfig[];
  results: Record<string, RunResult | 'running'>;
}

const STATUS_TITLE: Record<CellStatus, string> = {
  match: 'matches expected',
  mismatch: 'differs from expected',
  missing: 'required by expected, missing',
  'missing-ok': 'optional in expected, absent',
  extra: 'not in expected',
  'extra-ok': 'not in expected, allowed by $optional-properties$',
  absent: '',
  present: '',
};

export function AlignedTable({ expected, servers, results }: Props) {
  const [onlyInteresting, setOnlyInteresting] = useState(true);
  const [showVolatile, setShowVolatile] = useState(false);

  const done = servers.map((s) => {
    const r = results[s.id];
    return r && r !== 'running' ? r : undefined;
  });

  const rows = useMemo(
    () =>
      align(
        // without any run we still show the expected layout
        expected,
        servers.map((s, i) => ({
          id: s.id,
          actual: done[i]?.normalised,
          ctx: {
            modes: new Set(s.modes),
            externals: done[i]?.externals ?? null,
            variables: done[i]?.fhirVersion ? { version: done[i]!.fhirVersion! } : ({} as Record<string, string>),
          },
        })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expected, servers, results],
  );

  const anyRun = done.some((d) => d?.normalised !== undefined);
  const visible = rows.filter((r) => {
    if (!anyRun) return true;
    if (r.volatile && !showVolatile) return false;
    return !onlyInteresting || r.interesting;
  });
  const hiddenVolatile = rows.filter((r) => r.volatile).length;

  return (
    <div className="fill">
      <div className="toolbar">
        <label>
          <input type="checkbox" checked={onlyInteresting} onChange={(e) => setOnlyInteresting(e.target.checked)} /> Only rows
          with differences
        </label>
        <label>
          <input type="checkbox" checked={showVolatile} onChange={(e) => setShowVolatile(e.target.checked)} /> Show volatile
          fields ({hiddenVolatile})
        </label>
        <span className="muted small">
          {visible.length} of {rows.length} rows · rows are aligned by identity (parameter name, property code, concept code,
          issue severity/code), not array position
        </span>
      </div>
      {anyRun && visible.length === 0 && (
        <p className="t-pass">All servers agree with each other and with the expected response (ignoring volatile fields).</p>
      )}
      {visible.length > 0 && (
        <div className="table-wrap">
          <table className="aligned">
            <thead>
              <tr>
                <th>Path</th>
                <th>Expected</th>
                {servers.map((s) => (
                  <th key={s.id}>{s.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.key} className={row.agree ? '' : 'disagree'}>
                  <td className="mono path">
                    {prettyKey(row.key)}
                    {row.volatile && <span className="tag">volatile</span>}
                    {!row.agree && <span className="tag warn">servers differ</span>}
                  </td>
                  <td className="mono">
                    {row.expected ? (
                      <ExpectedCell value={row.expected.value} optional={row.expected.optional} only={row.expected.only} />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  {servers.map((s) => {
                    const c = row.cells[s.id];
                    return (
                      <td key={s.id} className={`mono cell-${c.status}`} title={STATUS_TITLE[c.status]}>
                        {c.value ?? (c.status === 'missing' || c.status === 'missing-ok' ? <em>missing</em> : '')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExpectedCell({ value, optional, only }: { value: string; optional?: string; only?: string }) {
  const tpl = isTemplate(value);
  return (
    <span>
      <span className={tpl ? 'template' : ''} title={tpl ? describeTemplate(value, null, {}) : undefined}>
        {value}
      </span>
      {optional && optional !== 'false' && (
        <span className="tag" title={`$optional$: ${optional}`}>
          optional{optional !== 'true' && optional !== 'property' ? `: ${optional}` : ''}
        </span>
      )}
      {only && (
        <span className="tag" title={`$only$: ${only}`}>
          only: {only}
        </span>
      )}
    </span>
  );
}
