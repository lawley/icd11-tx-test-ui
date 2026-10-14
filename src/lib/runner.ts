// Executes one tx-ecosystem test against one server, the way TxTester does.
import { compareJson, isObject, type CompareResult, type Json, type JsonObject } from './compare';
import { normaliseActual } from './normalise';
import type { ServerConfig } from './servers';
import {
  chooseParam,
  fetchJson,
  loadExternals,
  passesModes,
  versionGateMatches,
  type SuiteDef,
  type TestDef,
  type TestSource,
} from './tests';

export type Outcome = 'pass' | 'fail' | 'error' | 'skipped';

export interface RunResult {
  serverId: string;
  outcome: Outcome;
  /** Java-style one line message: first difference, http code failure, or error. */
  message?: string;
  fhirVersion?: string;
  httpStatus?: number;
  httpExpected: string;
  httpOk?: boolean;
  ms?: number;
  method?: string;
  url?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: Json;
  responseText?: string;
  /** Parsed response as returned. */
  actual?: Json;
  /** Response after R4->R5 conversion, scrubbing and sorting - what is compared. */
  normalised?: Json;
  expected?: Json;
  compare?: CompareResult;
  /** Externals in force for this server + response file (null: fragments used). */
  externals?: Record<string, string> | null;
  modes: string[];
  at: string;
}

export interface RunOptions {
  source: TestSource;
  useProxy: boolean;
  signal?: AbortSignal;
}

const OP_PATHS: Record<string, string> = {
  expand: 'ValueSet/$expand',
  'validate-code': 'ValueSet/$validate-code',
  'cs-validate-code': 'CodeSystem/$validate-code',
  lookup: 'CodeSystem/$lookup',
  subsumes: 'CodeSystem/$subsumes',
  translate: 'ConceptMap/$translate',
  compare: 'CodeSystem/$compare',
  closure: '$closure',
  'batch-validate': 'ValueSet/$batch-validate-code',
  batch: '',
};

const FHIR_JSON = 'application/fhir+json';

export function proxied(url: string, useProxy: boolean): string {
  return useProxy ? `/__proxy/${encodeURIComponent(url)}` : url;
}

const join = (base: string, path: string) => (path ? `${base.replace(/\/+$/, '')}/${path}` : base.replace(/\/+$/, ''));

const versionCache = new Map<string, Promise<string>>();

/** Like TxTester.determineFhirVersion: $versions, then /metadata. */
export function serverFhirVersion(server: ServerConfig, useProxy: boolean): Promise<string> {
  const key = `${server.base}|${useProxy}`;
  let p = versionCache.get(key);
  if (!p) {
    p = (async () => {
      const hdrs = { Accept: FHIR_JSON };
      try {
        const r = await fetch(proxied(join(server.base, '$versions'), useProxy), { headers: hdrs });
        if (r.ok) {
          const j = (await r.json()) as JsonObject;
          const def = (j.parameter as JsonObject[] | undefined)?.find((x) => x.name === 'default');
          const v = def?.valueCode ?? def?.valueString;
          if (typeof v === 'string') return v;
        }
      } catch {
        /* fall through */
      }
      const r = await fetch(proxied(join(server.base, 'metadata?_summary=true'), useProxy), { headers: hdrs });
      if (!r.ok) throw new Error(`metadata: HTTP ${r.status}`);
      const j = (await r.json()) as JsonObject;
      if (typeof j.fhirVersion !== 'string') throw new Error('metadata has no fhirVersion');
      return j.fhirVersion;
    })();
    p.catch(() => versionCache.delete(key));
    versionCache.set(key, p);
  }
  return p;
}

export function clearVersionCache() {
  versionCache.clear();
}

const externalsCache = new Map<string, Promise<Record<string, Record<string, string>> | null>>();

function externalsFor(source: TestSource, file: string | undefined) {
  if (!file) return Promise.resolve(null);
  const key = `${source.repo}@${source.ref}:${file}`;
  let p = externalsCache.get(key);
  if (!p) {
    p = loadExternals(source, file).catch(() => null);
    externalsCache.set(key, p);
  }
  return p;
}

function httpCodeOk(tcode: string, code: number): boolean {
  const m = /^([1-5])xx$/.exec(tcode);
  if (m) return Math.floor(code / 100) === Number(m[1]);
  return String(code) === tcode;
}

/** Why a test would not run for a server (mode/version gates), or null. */
export function skipReason(suite: SuiteDef, test: TestDef, modes: Set<string>, fhirVersion?: string): string | null {
  if (suite.disabled || test.disabled) return 'disabled';
  if (!passesModes(suite, modes)) return `suite needs mode ${suite.mode ?? suite.modes}`;
  if (!passesModes(test, modes)) return `test needs mode ${test.mode ?? test.modes}`;
  if (fhirVersion && test.version && !versionGateMatches(test.version, fhirVersion)) {
    return `test is for FHIR ${test.version}, server is ${fhirVersion}`;
  }
  return null;
}

export async function buildRequest(suite: SuiteDef, test: TestDef, modes: Set<string>, source: TestSource) {
  const op = test.operation;
  const reqFile = chooseParam(test, 'request', modes);
  let body: Json | undefined = reqFile ? structuredClone(await fetchJson(source, reqFile)) : undefined;
  if (isObject(body) && body.resourceType === 'Parameters') {
    const params = ((body.parameter as Json[]) ??= []);
    if (test['lenient-display'] != null && (op === 'validate-code' || op === 'cs-validate-code')) {
      params.push({ name: 'lenient-display-validation', valueBoolean: !!test['lenient-display'] });
    }
    if (op !== 'batch') {
      for (const f of suite.setup ?? []) {
        params.push({ name: 'tx-resource', resource: await fetchJson(source, f) });
      }
    }
    if (test.profile) {
      const profile = await fetchJson<JsonObject>(source, test.profile);
      params.push(...(((profile.parameter as Json[]) ?? []) as Json[]));
    }
  }
  return body;
}

export async function runTest(suite: SuiteDef, test: TestDef, server: ServerConfig, opts: RunOptions): Promise<RunResult> {
  const modes = new Set(server.modes);
  const base: RunResult = {
    serverId: server.id,
    outcome: 'error',
    httpExpected: test['http-code'] ?? '2xx',
    modes: [...modes],
    at: new Date().toISOString(),
  };
  try {
    const fhirVersion = await serverFhirVersion(server, opts.useProxy);
    base.fhirVersion = fhirVersion;
    const skip = skipReason(suite, test, modes, fhirVersion);
    if (skip) return { ...base, outcome: 'skipped', message: skip };

    const respFile = chooseParam(test, 'response', modes);
    const [expected, externalsFile] = await Promise.all([
      respFile ? fetchJson(opts.source, respFile) : Promise.resolve(undefined),
      externalsFor(opts.source, server.externals),
    ]);
    base.expected = expected;

    const op = test.operation;
    const headers: Record<string, string> = { Accept: FHIR_JSON };
    // Via the proxy, no Accept-Language reaches the server unless the test sets one
    // (as with the Java runner). Direct from a browser, its default is always sent.
    if (test['Accept-Language']) headers[opts.useProxy ? 'X-Tx-Accept-Language' : 'Accept-Language'] = test['Accept-Language'];
    if (test.header && (!test.header.mode || modes.has(test.header.mode))) headers[test.header.name] = test.header.value;

    let method = 'POST';
    let url: string;
    let body: Json | undefined;
    if (op === 'metadata') {
      method = 'GET';
      url = join(server.base, 'metadata');
    } else if (op === 'term-caps') {
      method = 'GET';
      url = join(server.base, 'metadata?mode=terminology');
    } else if (op in OP_PATHS) {
      url = join(server.base, OP_PATHS[op]);
      body = await buildRequest(suite, test, modes, opts.source);
      headers['Content-Type'] = FHIR_JSON;
    } else {
      return { ...base, outcome: 'error', message: `Unknown operation ${op}` };
    }

    const t0 = performance.now();
    const res = await fetch(proxied(url, opts.useProxy), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: opts.signal,
    });
    const text = await res.text();
    const ms = Math.round(performance.now() - t0);
    Object.assign(base, { method, url, requestHeaders: headers, requestBody: body, httpStatus: res.status, ms, responseText: text });

    let actual: Json;
    try {
      actual = JSON.parse(text) as Json;
    } catch {
      return { ...base, outcome: 'error', message: `Response is not JSON (HTTP ${res.status})` };
    }
    base.actual = actual;
    const normalised = normaliseActual(actual, fhirVersion);
    base.normalised = normalised;
    if (!isObject(normalised)) {
      return { ...base, outcome: 'error', message: 'Response is not a JSON object' };
    }

    const httpOk = httpCodeOk(base.httpExpected, res.status);
    base.httpOk = httpOk;
    if (expected === undefined) return { ...base, outcome: 'error', message: 'Test has no response file' };

    const externals = externalsFile && respFile ? externalsFile[respFile] ?? null : null;
    base.externals = externals;
    const result = compareJson(expected, normalised, {
      modes,
      externals,
      variables: { version: fhirVersion },
      patternMode: op === 'metadata' || op === 'term-caps',
    });
    base.compare = result;
    if (!httpOk) {
      return { ...base, outcome: 'fail', message: `Response Code fail: should be '${base.httpExpected}' but is '${res.status}'` };
    }
    if (!result.pass) {
      const d = result.diffs[0];
      return { ...base, outcome: 'fail', message: `${d.message} at ${d.path || '(root)'}` };
    }
    return { ...base, outcome: 'pass' };
  } catch (e) {
    if ((e as Error).name === 'AbortError') return { ...base, outcome: 'error', message: 'Aborted' };
    return { ...base, outcome: 'error', message: (e as Error).message };
  }
}
