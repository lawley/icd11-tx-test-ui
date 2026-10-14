// Ports of TxTesterScrubbers and TxTesterSorters (JSON form), plus the R4 -> R5
// response conversion the Java runner gets from its version converters.
import { isObject, type Json, type JsonObject } from './compare';

const MANAGED_EXTENSIONS = new Set([
  'http://hl7.org/fhir/StructureDefinition/codesystem-alternate',
  'http://hl7.org/fhir/StructureDefinition/codesystem-conceptOrder',
  'http://hl7.org/fhir/StructureDefinition/codesystem-label',
  'http://hl7.org/fhir/StructureDefinition/coding-sctdescid',
  'http://hl7.org/fhir/StructureDefinition/structuredefinition-standards-status',
  'http://hl7.org/fhir/StructureDefinition/itemWeight',
  'http://hl7.org/fhir/StructureDefinition/rendering-style',
  'http://hl7.org/fhir/StructureDefinition/rendering-xhtml',
  'http://hl7.org/fhir/StructureDefinition/translation',
  'http://hl7.org/fhir/StructureDefinition/valueset-concept-definition',
  'http://hl7.org/fhir/StructureDefinition/valueset-conceptOrder',
  'http://hl7.org/fhir/StructureDefinition/valueset-deprecated',
  'http://hl7.org/fhir/StructureDefinition/valueset-label',
  'http://hl7.org/fhir/StructureDefinition/valueset-supplement',
  'http://hl7.org/fhir/test/CodeSystem/de-multi',
  'http://hl7.org/fhir/test/CodeSystem/en-multi',
  'http://hl7.org/fhir/test/StructureDefinition/unknown-extension-1',
  'http://hl7.org/fhir/test/StructureDefinition/unknown-extension-3',
  'http://hl7.org/fhir/test/StructureDefinition/unknown-extension-4',
  'http://hl7.org/fhir/test/StructureDefinition/unknown-extension-5',
  'http://hl7.org/fhir/test/ValueSet/extensions-bad-supplement',
  'http://hl7.org/fhir/test/ValueSet/simple-all',
  'http://hl7.org/fhir/test/ValueSet/simple-enumerated',
  'http://hl7.org/fhir/StructureDefinition/alternate-code-use',
  'http://hl7.org/fhir/StructureDefinition/alternate-code-status',
  'http://hl7.org/fhir/StructureDefinition/operationoutcome-message-id',
  'http://hl7.org/fhir/test/ValueSet/simple-filter-isa',
  'http://hl7.org/fhir/StructureDefinition/valueset-unclosed',
  'http://hl7.org/fhir/StructureDefinition/valueset-unclosed-reason',
]);

const R5_EXT = 'http://hl7.org/fhir/5.0/StructureDefinition/extension-';

const clone = <T extends Json>(j: T): T => structuredClone(j);

const isManaged = (url: Json | undefined, tight: boolean) =>
  tight || typeof url !== 'string' || !/^[a-z][a-z0-9+.-]*:/i.test(url) || MANAGED_EXTENSIONS.has(url);

/** Drop empty arrays/objects and nulls, like a parse+serialise round trip would. */
export function prune(j: Json): Json | undefined {
  if (Array.isArray(j)) {
    const a = j.map(prune).filter((x): x is Json => x !== undefined);
    return a.length ? a : undefined;
  }
  if (isObject(j)) {
    const o: JsonObject = {};
    for (const [k, v] of Object.entries(j)) {
      const p = prune(v);
      if (p !== undefined) o[k] = p;
    }
    return Object.keys(o).length ? o : undefined;
  }
  return j === null ? undefined : j;
}

// ---- R4 -> R5 ----

function extValue(e: JsonObject): [string, Json] | undefined {
  return Object.entries(e).find(([k]) => k.startsWith('value'));
}

function convertExpansionProperty(ext: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const sub of (ext.extension as JsonObject[] | undefined) ?? []) {
    const v = extValue(sub);
    if (v && typeof sub.url === 'string') out[sub.url] = v[1];
  }
  return out;
}

function convertContainsProperty(ext: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const sub of (ext.extension as JsonObject[] | undefined) ?? []) {
    const v = extValue(sub);
    if (!v) continue;
    if (sub.url === 'code') out.code = v[1];
    else if (sub.url === 'value') out[v[0]] = v[1];
    else if (sub.url === 'subProperty') out.subProperty = [convertContainsProperty(sub)];
  }
  return out;
}

function liftExtensions(o: JsonObject, url: string, target: string, conv: (e: JsonObject) => JsonObject) {
  if (!Array.isArray(o.extension)) return;
  const keep: Json[] = [];
  const lifted: Json[] = [];
  for (const e of o.extension) {
    if (isObject(e) && e.url === url) lifted.push(conv(e));
    else keep.push(e);
  }
  if (lifted.length) {
    o[target] = [...((o[target] as Json[]) ?? []), ...lifted];
    if (keep.length) o.extension = keep;
    else delete o.extension;
  }
}

function contains4to5(list: Json[] | undefined) {
  for (const c of list ?? []) {
    if (!isObject(c)) continue;
    liftExtensions(c, `${R5_EXT}ValueSet.expansion.contains.property`, 'property', convertContainsProperty);
    contains4to5(c.contains as Json[]);
  }
}

/** Convert the R4-specific bits of a terminology response into R5 form. */
export function r4ToR5(res: Json): Json {
  const r = clone(res);
  if (!isObject(r)) return r;
  if (r.resourceType === 'ValueSet' && isObject(r.expansion)) {
    liftExtensions(r.expansion, `${R5_EXT}ValueSet.expansion.property`, 'property', convertExpansionProperty);
    contains4to5(r.expansion.contains as Json[]);
  }
  if (r.resourceType === 'Parameters') {
    for (const p of (r.parameter as Json[]) ?? []) {
      if (isObject(p) && isObject(p.resource)) p.resource = r4ToR5(p.resource);
    }
  }
  return r;
}

// ---- scrubbers ----

function filterOwnExtensions(o: JsonObject, tight: boolean) {
  if (!Array.isArray(o.extension)) return;
  const kept = o.extension.filter((e) => isObject(e) && isManaged(e.url, tight));
  if (kept.length) o.extension = kept;
  else delete o.extension;
}

// ElementVisitor: unmanaged extensions go everywhere, except that ValueSet.compose
// loses its own extensions but its children are not visited.
function scrubExtensions(j: Json, tight: boolean): void {
  if (Array.isArray(j)) {
    j.forEach((x) => scrubExtensions(x, tight));
    return;
  }
  if (!isObject(j)) return;
  filterOwnExtensions(j, tight);
  for (const [k, v] of Object.entries(j)) {
    if (k === 'resource' && isObject(v)) continue; // nested resources scrubbed explicitly
    if (k === 'compose' && isObject(v)) {
      filterOwnExtensions(v, tight);
      continue;
    }
    scrubExtensions(v, tight);
  }
}

function scrubDomainResource(r: JsonObject, tight: boolean) {
  delete r.text;
  delete r.meta;
  scrubExtensions(r, tight);
}

function scrubOperationOutcome(oo: JsonObject, tight: boolean) {
  scrubDomainResource(oo, tight);
  let issues = (oo.issue as JsonObject[] | undefined) ?? [];
  if (issues.length > 1) issues = issues.filter((i) => !(i.diagnostics != null && i.details == null));
  for (const i of issues) delete i.diagnostics;
  oo.issue = issues;
}

function scrubParameters(p: JsonObject, tight: boolean) {
  delete p.meta;
  p.parameter = ((p.parameter as JsonObject[] | undefined) ?? []).filter((x) => x.name !== 'diagnostics');
  for (const pp of p.parameter as JsonObject[]) {
    if (isObject(pp.resource)) scrub(pp.resource, tight);
  }
}

export function scrub(r: JsonObject, tight = false): JsonObject {
  switch (r.resourceType) {
    case 'ValueSet': scrubDomainResource(r, tight); break;
    case 'OperationOutcome': scrubOperationOutcome(r, tight); break;
    case 'Parameters': scrubParameters(r, tight); break;
    default: break; // CapabilityStatement / TerminologyCapabilities: nothing
  }
  return r;
}

// ---- sorters ----

const str = (j: Json | undefined): string => (j == null ? '' : typeof j === 'object' ? '' : String(j));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const primitiveValue = (o: JsonObject | undefined): string | undefined => {
  if (!o) return undefined;
  const e = Object.entries(o).find(([k, v]) => k.startsWith('value') && (typeof v !== 'object' || v === null));
  return e ? String(e[1]) : undefined;
};
const part = (p: JsonObject, name: string) =>
  ((p.part as JsonObject[] | undefined) ?? []).find((x) => x.name === name);

function sortExtensions(list: Json[] | undefined) {
  if (!list) return;
  for (const e of list) if (isObject(e)) sortExtensions(e.extension as Json[]);
  list.sort((a, b) => cmp(str((a as JsonObject).url), str((b as JsonObject).url)));
}

function parameterCompare(o1: JsonObject, o2: JsonObject): number {
  const n1 = str(o1.name);
  const n2 = str(o2.name);
  if (n1 === n2 && n1 === 'property') {
    const c1 = (primitiveValue(part(o1, 'code')) ?? '').toLowerCase();
    const c2 = (primitiveValue(part(o2, 'code')) ?? '').toLowerCase();
    if (c1 !== c2) return cmp(c1, c2);
    const v1 = primitiveValue(part(o1, 'value'))?.toLowerCase();
    const v2 = primitiveValue(part(o2, 'value'))?.toLowerCase();
    if (v1 != null && v2 != null && v1 !== v2) return cmp(v1, v2);
  }
  if (n1 === n2 && n1 === 'designation') {
    const c1 = (primitiveValue(part(o1, 'language')) ?? '').toLowerCase();
    const c2 = (primitiveValue(part(o2, 'language')) ?? '').toLowerCase();
    if (c1 !== c2) return cmp(c1, c2);
    const v1 = primitiveValue(part(o1, 'value'))?.toLowerCase();
    const v2 = primitiveValue(part(o2, 'value'))?.toLowerCase();
    if (v1 != null && v2 != null && v1 !== v2) return cmp(v1, v2);
  }
  return cmp(n1, n2);
}

function sortParameterList(list: JsonObject[]) {
  for (const p of list) {
    sortExtensions(p.extension as Json[]);
    if (Array.isArray(p.part)) sortParameterList(p.part as JsonObject[]);
  }
  list.sort(parameterCompare);
}

function issueCompare(o1: JsonObject, o2: JsonObject): number {
  const key = (o: JsonObject) => [
    str(o.severity),
    str(o.code),
    str((o.expression as Json[] | undefined)?.[0]),
    isObject(o.details) ? str(o.details.text) : '',
  ];
  const k1 = key(o1);
  const k2 = key(o2);
  for (let i = 0; i < k1.length; i++) if (k1[i] !== k2[i]) return cmp(k1[i], k2[i]);
  return 0;
}

export function sortOperationOutcome(oo: JsonObject) {
  (oo.issue as JsonObject[] | undefined)?.sort(issueCompare);
}

export function sortParameters(p: JsonObject) {
  const list = (p.parameter as JsonObject[] | undefined) ?? [];
  sortParameterList(list);
  for (const pp of list) {
    if (isObject(pp.resource) && pp.resource.resourceType === 'OperationOutcome') sortOperationOutcome(pp.resource);
    if (isObject(pp.resource) && pp.resource.resourceType === 'Parameters') sortParameters(pp.resource);
    if (pp.name === 'message' && typeof pp.valueString === 'string' && pp.valueString.includes('; ')) {
      pp.valueString = pp.valueString.split('; ').sort().join('; ');
    }
  }
}

function sortContains(list: JsonObject[] | undefined) {
  if (!list) return;
  list.sort((a, b) => cmp(str(a.code), str(b.code)));
  for (const c of list) {
    sortContains(c.contains as JsonObject[]);
    sortExtensions(c.extension as Json[]);
    (c.designation as JsonObject[] | undefined)?.sort((a, b) =>
      a.language != null && b.language != null ? cmp(str(a.language), str(b.language)) : cmp(str(a.value), str(b.value)),
    );
    (c.property as JsonObject[] | undefined)?.sort((a, b) => cmp(str(a.code), str(b.code)));
  }
}

export function sortValueSet(vs: JsonObject) {
  sortExtensions(vs.extension as Json[]);
  const exp = vs.expansion;
  if (!isObject(exp)) return;
  (exp.parameter as JsonObject[] | undefined)?.sort((a, b) => {
    sortExtensions(a.extension as Json[]);
    sortExtensions(b.extension as Json[]);
    return cmp(str(a.name), str(b.name)) || cmp(primitiveValue(a) ?? '', primitiveValue(b) ?? '');
  });
  (exp.property as JsonObject[] | undefined)?.sort((a, b) => {
    if (a.uri == null || b.uri == null) {
      const i = a.uri == null && b.uri == null ? 0 : a.uri == null ? -1 : 1;
      return i || cmp(str(a.code), str(b.code));
    }
    return cmp(str(a.uri), str(b.uri)) || cmp(str(a.code), str(b.code));
  });
  sortExtensions(exp.extension as Json[]);
  sortContains(exp.contains as JsonObject[]);
}

export function sortTermCaps(tc: JsonObject) {
  const cs = (tc.codeSystem as JsonObject[] | undefined) ?? [];
  cs.sort((a, b) => cmp(str(a.uri), str(b.uri)));
  for (const t of cs) {
    const versions = (t.version as JsonObject[] | undefined) ?? [];
    versions.sort((a, b) => (a.code == null || b.code == null ? 0 : cmp(str(a.code), str(b.code))));
    for (const v of versions) {
      (v.language as Json[] | undefined)?.sort((a, b) => cmp(str(a), str(b)));
      (v.property as Json[] | undefined)?.sort((a, b) => cmp(str(a), str(b)));
      (v.filter as JsonObject[] | undefined)?.sort((a, b) => cmp(str(a.code), str(b.code)));
    }
  }
  if (isObject(tc.expansion)) {
    (tc.expansion.parameter as JsonObject[] | undefined)?.sort((a, b) => cmp(str(a.name), str(b.name)));
  }
}

export function sortResource(r: JsonObject): JsonObject {
  switch (r.resourceType) {
    case 'ValueSet': sortValueSet(r); break;
    case 'Parameters': sortParameters(r); break;
    case 'OperationOutcome': break; // Java does not sort a top-level OO from an error response
    case 'TerminologyCapabilities': sortTermCaps(r); break;
    default: break;
  }
  return r;
}

/** Full pipeline the Java runner applies to an actual response before comparing. */
export function normaliseActual(resource: Json, fhirVersion: string, tight = false): Json {
  let r: Json = prune(clone(resource)) ?? {};
  if (fhirVersion.startsWith('4.') || fhirVersion.startsWith('3.')) r = r4ToR5(r);
  if (!isObject(r)) return r;
  scrub(r, tight);
  sortResource(r);
  return prune(r) ?? {};
}
