// Loads test-cases.json and referenced files from the HL7 fhir-tx-ecosystem-ig repo.
import type { Json, JsonObject } from './compare';

export interface TestDef {
  name: string;
  description?: string;
  operation: string;
  request?: string;
  response?: string;
  'http-code'?: string;
  'Accept-Language'?: string;
  'lenient-display'?: boolean;
  profile?: string;
  mode?: string;
  modes?: string[] | string;
  version?: string;
  disabled?: boolean;
  /** Comma separated features the server must declare (see features.ts). */
  feature?: string;
  header?: { name: string; value: string; mode?: string };
  [k: string]: unknown;
}

export interface SuiteDef {
  name: string;
  description?: string;
  mode?: string;
  modes?: string[] | string;
  setup?: string[];
  feature?: string;
  tests: TestDef[];
  disabled?: boolean;
}

export interface TestSource {
  repo: string; // owner/name
  ref: string; // branch, tag or sha
}

export const DEFAULT_SOURCE: TestSource = { repo: 'HL7/fhir-tx-ecosystem-ig', ref: 'main' };

const cache = new Map<string, Promise<string>>();

export function rawUrl(src: TestSource, path: string): string {
  return `https://raw.githubusercontent.com/${src.repo}/${src.ref}/tests/${path}`;
}

export function githubUrl(src: TestSource, path: string): string {
  return `https://github.com/${src.repo}/blob/${src.ref}/tests/${path}`;
}

export function fetchText(src: TestSource, path: string): Promise<string> {
  const url = rawUrl(src, path);
  let p = cache.get(url);
  if (!p) {
    p = fetch(url, { cache: 'no-cache' }).then(async (r) => {
      if (!r.ok) throw new Error(`${r.status} fetching ${url}`);
      return r.text();
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

export async function fetchJson<T = Json>(src: TestSource, path: string): Promise<T> {
  return JSON.parse(await fetchText(src, path)) as T;
}

export function clearCache() {
  cache.clear();
}

export async function loadSuites(src: TestSource): Promise<SuiteDef[]> {
  const tc = await fetchJson<{ suites: SuiteDef[] }>(src, 'test-cases.json');
  return tc.suites;
}

/** Externals files, keyed by response file then message number. */
export async function loadExternals(src: TestSource, file: string): Promise<Record<string, Record<string, string>>> {
  return fetchJson(src, file);
}

export const asList = (m: string[] | string | undefined): string[] =>
  m == null ? [] : Array.isArray(m) ? m : m.split(',').map((s) => s.trim());

/** Mirrors TxTester.passesModes. */
export function passesModes(item: { mode?: string; modes?: string[] | string }, modes: Set<string>): boolean {
  if (asList(item.modes).some((m) => modes.has(m))) return true;
  if (item.mode) return modes.has(item.mode);
  return true;
}

/** Mirrors TxTester.versionGateMatches. */
export function versionGateMatches(gate: string | undefined, version: string): boolean {
  if (!gate) return true;
  const neg = gate.startsWith('!');
  const g = neg ? gate.slice(1) : gate;
  const hit = version === g || version.startsWith(`${g}.`);
  return neg ? !hit : hit;
}

/** request:{mode} / response:{mode} alternatives. */
export function chooseParam(test: TestDef, name: 'request' | 'response', modes: Set<string>): string | undefined {
  for (const m of modes) {
    const v = test[`${name}:${m}`];
    if (typeof v === 'string') return v;
  }
  return test[name] as string | undefined;
}

export type { JsonObject };
