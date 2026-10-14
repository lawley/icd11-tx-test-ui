// Port of org.hl7.fhir.r5.test.utils.CompareUtilities (JSON half) from
// hapifhir/org.hl7.fhir.core, as used by TxTester for the tx-ecosystem tests.
//
// Difference from the Java: Java stops at the first difference; this collects
// all of them. Pass/fail is identical - every point where Java would return a
// message records a diff here, and nothing before that point differs.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export interface CompareContext {
  modes: Set<string>;
  /** Externals for this response file (key -> message), or null if none. */
  externals: Record<string, string> | null;
  /** Variables, e.g. version -> the server's FHIR version code. */
  variables: Record<string, string>;
  patternMode?: boolean;
}

export interface Diff {
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface CompareResult {
  pass: boolean;
  diffs: Diff[];
  warnings: string[];
}

const ID_REGEX = /^[A-Za-z0-9\-.]{1,64}$/;
const INSTANT_REGEX =
  /^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]{1,9})?(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00))$/;
const DATE_REGEX =
  /^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])(T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]{1,9})?(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00)))?$/;
const URN_UUID_REGEX = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_REGEX = /^(((https?):\/\/)(%[0-9A-Fa-f]{2}|[-()_.!~*';/?:@&=+$,A-Za-z0-9])+)([).!';/?:,][ \t]?)?$/;
const TOKEN_REGEX = /^[0-9a-zA-Z_][0-9a-zA-Z_.\-]*$/;
const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

export const isObject = (j: Json | undefined): j is JsonObject =>
  j !== null && typeof j === 'object' && !Array.isArray(j);

const kind = (j: Json): string => (j === null ? 'null' : Array.isArray(j) ? 'array' : typeof j);

export function isTemplate(s: string): boolean {
  return s.length > 1 && s.startsWith('$') && s.endsWith('$');
}

/** Template keywords that stand for "any value of a kind" - i.e. volatile values. */
export const TYPE_TEMPLATES = new Set([
  '$$', '$instant$', '$date$', '$uuid$', '$string$', '$id$', '$url$', '$token$', '$semver$', '$version$',
]);

export class Comparer {
  readonly warnings: string[] = [];
  constructor(private readonly ctx: CompareContext) {}

  compare(expected: Json, actual: Json): CompareResult {
    const diffs = isObject(expected) && isObject(actual)
      ? this.compareObjects('', expected, actual)
      : this.compareNodes('', expected, actual, false, null);
    return { pass: diffs.length === 0, diffs, warnings: [...new Set(this.warnings)] };
  }

  // ---- filters ----

  passesOptionalFilter(token: string): boolean {
    if (token.startsWith('!')) return !this.ctx.modes.has(token.substring(1));
    if (token.startsWith('warning:')) return true;
    if (token.startsWith('version:')) {
      const v = this.ctx.variables.version;
      return v != null && v.startsWith(token.substring(8));
    }
    return this.ctx.modes.has(token);
  }

  isProhibited(e: Json | undefined): boolean {
    return isObject(e) && typeof e.$only$ === 'string' && !this.passesOptionalFilter(e.$only$);
  }

  isOptionalItem(e: Json): boolean {
    if (!isObject(e)) return false;
    if (this.isProhibited(e)) return true;
    if (typeof e.$optional$ === 'string') return this.passesOptionalFilter(e.$optional$);
    return e.$optional$ === true;
  }

  private optionalWarning(e: Json): string | null {
    return isObject(e) && typeof e.$optional$ === 'string' && e.$optional$.startsWith('warning:')
      ? e.$optional$.substring(8)
      : null;
  }

  // ---- objects ----

  compareObjects(path: string, expected: JsonObject, actual: JsonObject): Diff[] {
    const diffs: Diff[] = [];
    const optionals = listOptionals(expected);
    const countOnlys = strings(expected['$count-arrays$']);
    for (const [n, v] of Object.entries(actual)) {
      if (n === 'fhir_comments') continue;
      if (n in expected) {
        if (this.isProhibited(expected[n])) {
          diffs.push({
            path,
            message: `prohibited property ${n} (only allowed when '${(expected[n] as JsonObject).$only$}')`,
          });
          continue;
        }
        diffs.push(...this.compareNodes(`${path}.${n}`, expected[n], v, countOnlys.includes(n), n));
      } else if (!this.ctx.patternMode && !optionals.includes(n)) {
        diffs.push({ path, message: `unexpected property ${n}`, actual: preview(v) });
      }
    }
    for (const [n, v] of Object.entries(expected)) {
      if (n === 'fhir_comments' || isOptionalName(n, optionals) || this.isProhibited(v)) continue;
      if (!(n in actual) && !this.allOptional(v)) {
        diffs.push({ path, message: `missing property ${n}`, expected: preview(v) });
      }
    }
    return diffs;
  }

  private allOptional(v: Json): boolean {
    if (!Array.isArray(v)) return false;
    return v.every((e) => !isObject(e) || '$optional$' in e || this.isProhibited(e));
  }

  // ---- nodes ----

  compareNodes(path: string, expected: Json, actual: Json, countOnly: boolean, name: string | null): Diff[] {
    const ek = kind(expected);
    const ak = kind(actual);
    const ePrim = ek !== 'object' && ek !== 'array';
    const aPrim = ak !== 'object' && ak !== 'array';
    if (!(ePrim && aPrim) && ek !== ak) {
      return [{ path, message: 'properties differ (kind)', expected: ek, actual: ak }];
    }
    if (aPrim) return this.comparePrimitive(path, expected, actual);
    if (ak === 'object') return this.compareObjects(path, expected as JsonObject, actual as JsonObject);
    return this.compareArrays(path, expected as Json[], actual as Json[], countOnly, name);
  }

  private comparePrimitive(path: string, expected: Json, actual: Json): Diff[] {
    const fail = (message: string): Diff[] => [{ path, message, expected: show(expected), actual: show(actual) }];
    if (typeof actual === 'boolean' && typeof expected === 'boolean') {
      return actual === expected ? [] : fail('boolean property values differ');
    }
    if (typeof actual === 'string' && typeof expected === 'string') {
      if (actual.includes('<div') && expected.includes('<div')) return [];
      return this.matches(actual, expected) ? [] : fail('string property values differ');
    }
    if (typeof actual === 'number' && typeof expected === 'number') {
      return String(actual) === String(expected) ? [] : fail('number property values differ');
    }
    if (expected === null) return actual === null ? [] : fail('null properties differ');
    return fail('property types differ');
  }

  private compareArrays(path: string, expectedIn: Json[], actual: Json[], countOnly: boolean, name: string | null): Diff[] {
    // prohibited ($only$ not satisfied) items: report if found, then drop from expectations
    for (const e of expectedIn) {
      if (!this.isProhibited(e)) continue;
      for (let i = 0; i < actual.length; i++) {
        const probe = new Comparer(this.ctx);
        if (probe.compareNodes(`${path}[${i}]`, e, actual[i], false, null).length === 0) {
          return [{
            path: `${path}[${i}]`,
            message: `prohibited item found${describeItem(e)}: only allowed when '${(e as JsonObject).$only$}'`,
          }];
        }
      }
    }
    const expected = expectedIn.filter((e) => !this.isProhibited(e));
    const as = actual.length;
    const es = expected.length;
    if (countOnly) {
      return as === es ? [] : [{ path, message: 'array item count differs', expected: String(es), actual: String(as) }];
    }
    const diffs: Diff[] = [];
    if (this.ctx.patternMode) {
      let c = 0;
      for (let i = 0; i < es; i++) {
        let found = false;
        const tried: Diff[] = [];
        while (!found && c < as) {
          const d = new Comparer(this.ctx).compareNodes(`${path}[${i}]`, expected[i], actual[c], false, null);
          if (d.length === 0) found = true;
          else tried.push(...d);
          c++;
        }
        if (!found) {
          diffs.push({ path: `${path}[${i}]`, message: `expected item${describeItem(expected[i])} not found`, expected: preview(expected[i]) });
          return diffs;
        }
      }
      return diffs;
    }
    const optionalFlags = expected.map((e) => this.isOptionalItem(e));
    const expectedMin = optionalFlags.filter((o) => !o).length;
    const oc = es - expectedMin;
    if (as > es || as < expectedMin) {
      diffs.push({
        path,
        message: 'array item count differs',
        expected: expectedMin === es ? String(es) : `${expectedMin}..${es}`,
        actual: String(as),
      });
    }
    let c = 0;
    for (let i = 0; i < es; i++) {
      if (c >= as) {
        if (i >= es - oc && optionalFlags[i]) {
          const wt = this.optionalWarning(expected[i]);
          if (wt) this.warnings.push(wt);
          return diffs;
        }
        // Java reports this only if the count check passed; avoid a duplicate message
        if (diffs.length === 0) {
          diffs.push({ path, message: `one or more array items did not match, starting at index ${i}${describeItem(expected[i])}` });
        } else {
          for (let j = i; j < es; j++) {
            if (!optionalFlags[j]) diffs.push({ path: `${path}[${j}]`, message: `missing item${describeItem(expected[j])}`, expected: preview(expected[j]) });
          }
        }
        return diffs;
      }
      const sub = new Comparer(this.ctx);
      const s = sub.compareNodes(`${path}[${i}]`, expected[i], actual[c], false, null);
      if (s.length === 0) {
        this.warnings.push(...sub.warnings);
        c++;
      } else if (!optionalFlags[i]) {
        // Java fails here; keep going as if this pair matched, to report more
        diffs.push(...s);
        this.warnings.push(...sub.warnings);
        c++;
      }
    }
    if (c < as) {
      for (let j = c; j < as; j++) {
        diffs.push({ path: `${path}[${j}]`, message: `unexpected item in array${describeItem(actual[j])}`, actual: preview(actual[j]) });
      }
    }
    void name;
    return diffs;
  }

  // ---- templates ----

  matches(actual: string, expected: string): boolean {
    if (isTemplate(expected)) {
      if (expected.startsWith('$choice:')) return expected.slice(8, -1).split('|').includes(actual);
      if (expected.startsWith('$fragments:')) return containsAll(actual, expected.slice(11, -1).split('|'));
      if (expected.startsWith('$external:')) {
        const cmd = expected.slice(1, -1).split(':');
        if (this.ctx.externals) return actual === this.ctx.externals[cmd[1]];
        if (cmd.length <= 2) return true;
        // Java splits on every ':' and uses cmd[2] - so fragments containing ':' are truncated there
        return containsAll(actual, cmd[2].split('|'));
      }
      return matchesTypeTemplate(actual, expected, this.ctx.variables);
    }
    if (expected.includes('$version$') && this.ctx.variables.version) {
      expected = expected.replaceAll('$version$', this.ctx.variables.version);
    }
    return actual === expected;
  }
}

export function matchesTypeTemplate(actual: string, expected: string, variables: Record<string, string>): boolean {
  switch (expected) {
    case '$$': return true;
    case '$instant$': return INSTANT_REGEX.test(actual);
    case '$date$': return DATE_REGEX.test(actual);
    case '$uuid$': return URN_UUID_REGEX.test(actual);
    case '$string$': return actual === actual.trim();
    case '$id$': return ID_REGEX.test(actual);
    case '$url$': return URL_REGEX.test(actual);
    case '$token$': return TOKEN_REGEX.test(actual);
    case '$semver$': return SEMVER_REGEX.test(actual);
    case '$version$': return variables.version == null || actual === variables.version;
    default: throw new Error(`Unhandled template: ${expected}`);
  }
}

/** Human description of a template, mirroring presentExpected. */
export function describeTemplate(expected: string, externals: Record<string, string> | null, variables: Record<string, string>): string {
  if (!isTemplate(expected)) return expected;
  if (expected.startsWith('$choice:')) return `one of [${expected.slice(8, -1).split('|').join(', ')}]`;
  if (expected.startsWith('$fragments:')) return `contains all of [${expected.slice(11, -1).split('|').join(', ')}]`;
  if (expected.startsWith('$external:')) {
    const cmd = expected.slice(1, -1).split(':');
    if (externals) return `"${externals[cmd[1]]}" (external ${cmd[1]})`;
    return cmd.length > 2 ? `contains all of [${cmd[2].split('|').join(', ')}] (no external for ${cmd[1]})` : 'anything (no externals)';
  }
  switch (expected) {
    case '$$': return 'anything';
    case '$instant$': return 'an instant';
    case '$date$': return 'a date';
    case '$uuid$': return 'a urn:uuid';
    case '$string$': return 'a trimmed string';
    case '$id$': return 'an id';
    case '$url$': return 'a URL';
    case '$token$': return 'a token';
    case '$semver$': return 'a semver';
    case '$version$': return variables.version ?? '(any version)';
    default: return `unhandled template ${expected}`;
  }
}

function containsAll(actual: string, fragments: string[]): boolean {
  const a = actual.toLowerCase();
  return fragments.every((f) => a.includes(f.toLowerCase()));
}

function strings(j: Json | undefined): string[] {
  return Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string') : [];
}

function listOptionals(o: JsonObject): string[] {
  if (!('$optional-properties$' in o)) return [];
  return ['$optional-properties$', '$count-arrays$', ...strings(o['$optional-properties$'])];
}

function isOptionalName(n: string, optionals: string[]): boolean {
  return n === '$optional$' || n === '$only$' || optionals.includes('*') || optionals.includes(n);
}

function describeItem(e: Json): string {
  if (isObject(e) && typeof e.name === 'string') {
    if (e.name === 'property' && Array.isArray(e.part)) {
      const code = e.part.find((p) => isObject(p) && p.name === 'code');
      const v = isObject(code) ? Object.entries(code).find(([k]) => k.startsWith('value'))?.[1] : undefined;
      if (typeof v === 'string') return ` (property ${v})`;
    }
    return ` (name = ${e.name})`;
  }
  if (isObject(e) && typeof e.code === 'string') return ` (code = ${e.code})`;
  if (isObject(e) && typeof e.url === 'string') return ` (url = ${e.url})`;
  return '';
}

function show(j: Json): string {
  return typeof j === 'string' ? j : JSON.stringify(j);
}

export function preview(j: Json): string {
  const s = JSON.stringify(j);
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}

export function compareJson(expected: Json, actual: Json, ctx: CompareContext): CompareResult {
  return new Comparer(ctx).compare(expected, actual);
}
