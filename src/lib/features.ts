// Port of the feature gating in TxTester (org.hl7.fhir.core 7.0.3). A suite or test can say
// "feature": "a,b": it only runs when the server declares all of them. Unlike modes, which the
// person running the tests chooses, features come from what the server says about itself in
// its CapabilityStatement (see featuresFor).
import { isObject, type Json, type JsonObject } from './compare';

export const FEATURE_EXTENSION = 'http://hl7.org/fhir/uv/application-feature/StructureDefinition/feature';
export const CODESYSTEM_AS_PARAMETER = 'http://hl7.org/fhir/uv/tx-ecosystem/FeatureDefinition/CodeSystemAsParameter';

// operation name -> the feature declaring it gives
const OPERATION_FEATURES: [string, string][] = [
  ['expand', 'expand'],
  ['validate-code', 'validate'],
  ['lookup', 'lookup'],
  ['subsumes', 'subsumes'],
  ['translate', 'translate'],
  ['closure', 'closure'],
  ['related', 'related'],
];

const objects = (j: Json | undefined): JsonObject[] => (Array.isArray(j) ? j.filter(isObject) : []);
const primitive = (o: JsonObject): string | undefined => {
  const e = Object.entries(o).find(([k, v]) => k.startsWith('value') && v !== null && typeof v !== 'object');
  return e ? String(e[1]) : undefined;
};
const stripVersion = (canonical: string) => (canonical.includes('|') ? canonical.slice(0, canonical.indexOf('|')) : canonical);

function addOperationFeature(res: Set<string>, op: JsonObject) {
  const name = typeof op.name === 'string' ? op.name : undefined;
  const def = typeof op.definition === 'string' ? stripVersion(op.definition) : undefined;
  const tail = def === undefined ? undefined : def.slice(def.lastIndexOf('/') + 1);
  for (const [opName, feature] of OPERATION_FEATURES) {
    if (name === opName || (tail !== undefined && (tail === opName || tail.endsWith(`-${opName}`)))) res.add(feature);
  }
}

/**
 * The features a server declares in its CapabilityStatement (TxTester.featuresFor):
 * - an operation (expand, validate, lookup, subsumes, translate, closure, related) when it
 *   declares that operation anywhere - at system level, or on any resource - by name, or by an
 *   OperationDefinition whose id ends with it (ValueSet-expand, CodeSystem-validate-code...)
 * - tx-resource when it declares the CodeSystemAsParameter feature, with the value true
 */
export function featuresFor(cs: Json | undefined): Set<string> {
  const res = new Set<string>();
  if (!isObject(cs)) return res;
  const exts = objects(cs.extension);
  for (const rest of objects(cs.rest)) {
    exts.push(...objects(rest.extension));
    for (const op of objects(rest.operation)) {
      exts.push(...objects(op.extension));
      addOperationFeature(res, op);
    }
    for (const r of objects(rest.resource)) {
      exts.push(...objects(r.extension));
      for (const op of objects(r.operation)) {
        exts.push(...objects(op.extension));
        addOperationFeature(res, op);
      }
    }
  }
  for (const ext of exts) {
    if (ext.url !== FEATURE_EXTENSION) continue;
    let definition: string | undefined;
    let value: JsonObject | undefined;
    for (const sub of objects(ext.extension)) {
      if (sub.url === 'definition') definition = primitive(sub);
      else if (sub.url === 'value') value = sub;
    }
    if (definition !== undefined && stripVersion(definition) === CODESYSTEM_AS_PARAMETER && value?.valueBoolean === true) {
      res.add('tx-resource');
    }
  }
  return res;
}

/** The features a suite or test needs: its "feature", a comma separated list (TxTester.neededFeatures). */
export function neededFeatures(obj: { feature?: unknown } | undefined): string[] {
  const f = obj?.feature;
  if (typeof f !== 'string') return [];
  return f.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Why a test doesn't run because of its features: what it needs that the server doesn't declare
 * (TxTester.describeFeatureGate). Null if it isn't stopped by features. A feature that isn't one
 * the server can declare (a typo in the test cases, say) is never declared, so the test doesn't run.
 */
export function featureGate(suite: { feature?: unknown }, test: { feature?: unknown }, features: Set<string>): string | null {
  const missing: string[] = [];
  for (const f of [...neededFeatures(suite), ...neededFeatures(test)]) {
    if (!features.has(f) && !missing.includes(f)) missing.push(f);
  }
  if (!missing.length) return null;
  return `needs the feature(s) [${missing.join(', ')}], and the server only declares [${[...features].sort().join(', ')}]`;
}
