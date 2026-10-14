// Cross-server alignment: flattens expected + each actual response into leaf rows
// keyed by semantic identity (parameter name, property code, concept code, issue
// severity/code, extension url) rather than array index, so responses line up
// regardless of order, and so the eye can scan for genuine differences.
import { Comparer, isObject, isTemplate, TYPE_TEMPLATES, type CompareContext, type Json, type JsonObject } from './compare';

const DIRECTIVES = new Set(['$optional$', '$only$', '$optional-properties$', '$count-arrays$']);

/** Paths whose values legitimately vary per call. Matched against the row key. */
const VOLATILE = [/^\.id$/, /^\.expansion\.identifier$/, /^\.expansion\.timestamp$/, /^\.meta\b/, /\.diagnostics$/];

export interface Leaf {
  key: string;
  value: string;
  /** Expected-side only. */
  optional?: string;
  only?: string;
}

export interface ExpectedInfo {
  leaves: Map<string, Leaf>;
  /** object key -> property names it allows to be missing / extra */
  optionalProps: Map<string, string[]>;
  countArrays: Set<string>;
}

function partValue(o: JsonObject, name: string): string | undefined {
  const p = (o.part as Json[] | undefined)?.find((x) => isObject(x) && x.name === name);
  if (!isObject(p)) return undefined;
  const v = Object.entries(p).find(([k]) => k.startsWith('value'))?.[1];
  return v == null || typeof v === 'object' ? undefined : String(v);
}

export function itemIdentity(item: Json, index: number): string {
  if (!isObject(item)) return typeof item === 'string' ? item : String(index);
  if (typeof item.name === 'string') {
    if (item.name === 'property') return `property:${partValue(item, 'code') ?? '?'}`;
    if (item.name === 'designation') return `designation:${partValue(item, 'language') ?? ''}`;
    if (item.name === 'tx-resource' || item.name === 'valueSet') return `${item.name}`;
    return item.name;
  }
  if (typeof item.url === 'string' && !('code' in item)) return item.url;
  if (typeof item.severity === 'string') return `${item.severity}:${String(item.code ?? '')}`;
  if (typeof item.code === 'string' && typeof item.system === 'string') return item.code;
  if (typeof item.code === 'string') return item.code;
  if (typeof item.language === 'string') return `lang:${item.language}`;
  return String(index);
}

function walk(
  j: Json,
  key: string,
  out: Map<string, Leaf>,
  inherited: { optional?: string; only?: string },
  info?: ExpectedInfo,
) {
  if (Array.isArray(j)) {
    if (info && info.countArrays.has(key)) {
      out.set(key, { key, value: `[${j.length} items]`, ...inherited });
      return;
    }
    const seen = new Map<string, number>();
    j.forEach((item, i) => {
      const id = itemIdentity(item, i);
      const n = (seen.get(id) ?? 0) + 1;
      seen.set(id, n);
      const k = `${key}[${id}${n > 1 ? `#${n}` : ''}]`;
      let inh = inherited;
      if (info && isObject(item)) {
        if (item.$optional$ !== undefined) inh = { ...inh, optional: String(item.$optional$) };
        if (typeof item.$only$ === 'string') inh = { ...inh, only: item.$only$ };
      }
      walk(item, k, out, inh, info);
    });
    return;
  }
  if (isObject(j)) {
    if (info) {
      const op = j['$optional-properties$'];
      if (Array.isArray(op)) info.optionalProps.set(key, op.map(String));
      const ca = j['$count-arrays$'];
      if (Array.isArray(ca)) ca.forEach((n) => info.countArrays.add(`${key}.${String(n)}`));
    }
    const optionalProps = info?.optionalProps.get(key) ?? [];
    for (const [k, v] of Object.entries(j)) {
      if (info && DIRECTIVES.has(k)) continue;
      const childOptional = optionalProps.includes('*') || optionalProps.includes(k);
      walk(v, `${key}.${k}`, out, childOptional && !inherited.optional ? { ...inherited, optional: 'property' } : inherited, info);
    }
    return;
  }
  out.set(key, { key, value: j === null ? 'null' : String(j), ...inherited });
}

export function flattenExpected(expected: Json): ExpectedInfo {
  const info: ExpectedInfo = { leaves: new Map(), optionalProps: new Map(), countArrays: new Set() };
  walk(expected, '', info.leaves, {}, info);
  return info;
}

export function flattenActual(actual: Json, countArrays?: Set<string>): Map<string, Leaf> {
  const out = new Map<string, Leaf>();
  walk(actual, '', out, {}, countArrays ? { leaves: out, optionalProps: new Map(), countArrays } : undefined);
  return out;
}

export type CellStatus =
  | 'match' // matches expected
  | 'mismatch' // differs from expected
  | 'missing' // expected, required, absent
  | 'missing-ok' // expected but optional, absent
  | 'extra' // not in expected and not allowed
  | 'extra-ok' // not in expected, allowed by $optional-properties$
  | 'absent' // neither expected nor present
  | 'present'; // no expectation at all (no expected file)

export interface Row {
  key: string;
  expected?: Leaf;
  cells: Record<string, { value?: string; status: CellStatus }>;
  /** All servers that have a value agree (allowing for volatile values). */
  agree: boolean;
  volatile: boolean;
  interesting: boolean;
}

function allowedExtra(key: string, info: ExpectedInfo): boolean {
  // walk up the key: for each ancestor object, is the next segment an optional property?
  const segs = key.match(/\.[^.[]+|\[[^\]]*\]/g) ?? [];
  let parent = '';
  for (const s of segs) {
    if (s.startsWith('.')) {
      const props = info.optionalProps.get(parent);
      if (props && props.includes(s.slice(1))) return true; // '*' does not admit extras (Java)
    }
    parent += s;
  }
  return false;
}

export interface Column {
  id: string;
  actual?: Json;
  ctx: CompareContext;
}

export function align(expected: Json | undefined, columns: Column[]): Row[] {
  const info = expected !== undefined ? flattenExpected(expected) : undefined;
  const flats = columns.map((c) => (c.actual !== undefined ? flattenActual(c.actual, info?.countArrays) : new Map<string, Leaf>()));
  const keys: string[] = [];
  const seen = new Set<string>();
  const add = (k: string) => {
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  };
  info?.leaves.forEach((_, k) => add(k));
  flats.forEach((f) => f.forEach((_, k) => add(k)));
  keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return keys.map((key) => {
    const exp = info?.leaves.get(key);
    const volatile =
      VOLATILE.some((r) => r.test(key)) || (exp != null && TYPE_TEMPLATES.has(exp.value)) || exp?.value === '$$';
    const cells: Row['cells'] = {};
    const values: string[] = [];
    columns.forEach((col, i) => {
      const leaf = flats[i].get(key);
      const value = leaf?.value;
      if (col.actual === undefined) {
        cells[col.id] = { status: 'absent' };
        return;
      }
      if (value !== undefined) values.push(value);
      let status: CellStatus;
      if (!info) status = value === undefined ? 'absent' : 'present';
      else if (exp) {
        const cmp = new Comparer(col.ctx);
        const optional = exp.optional !== undefined && (exp.optional === 'property' || exp.optional === 'true' || isOptionalFor(exp.optional, cmp));
        if (value === undefined) status = optional || (exp.only && !cmp.passesOptionalFilter(exp.only)) ? 'missing-ok' : 'missing';
        else status = leafMatches(exp.value, value, cmp) ? 'match' : 'mismatch';
      } else if (value !== undefined) status = allowedExtra(key, info) ? 'extra-ok' : 'extra';
      else status = 'absent';
      cells[col.id] = { value, status };
    });
    const present = columns.filter((c) => cells[c.id].value !== undefined);
    let agree: boolean;
    if (volatile) {
      agree = present.length === columns.filter((c) => c.actual !== undefined).length || present.length === 0;
    } else {
      agree = new Set(values).size <= 1 && (present.length === 0 || present.length === columns.filter((c) => c.actual !== undefined).length);
    }
    const bad = Object.values(cells).some((c) => c.status === 'mismatch' || c.status === 'missing' || c.status === 'extra');
    return { key, expected: exp, cells, agree, volatile, interesting: bad || !agree };
  });
}

function isOptionalFor(token: string, cmp: Comparer): boolean {
  return token === 'true' || cmp.passesOptionalFilter(token);
}

function leafMatches(expected: string, actual: string, cmp: Comparer): boolean {
  if (/^\[\d+ items\]$/.test(expected)) return expected === actual;
  try {
    return cmp.matches(actual, expected);
  } catch {
    return false;
  }
}

export function prettyKey(key: string): string {
  return key.replace(/^\./, '');
}

export { isTemplate };
