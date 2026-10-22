import { describe, expect, it } from 'vitest';
import { CODESYSTEM_AS_PARAMETER, FEATURE_EXTENSION, featureGate, featuresFor, neededFeatures } from './features';
import type { JsonObject } from './compare';

// Port of TxTesterFeaturesTests (org.hl7.fhir.core 7.0.3)
const feature = (definition: string, value: JsonObject): JsonObject => ({
  url: FEATURE_EXTENSION,
  extension: [{ url: 'definition', valueCanonical: definition }, { url: 'value', ...value }],
});
const op = (name: string, definition: string) => ({ name, definition });

describe('featuresFor', () => {
  it('finds operations declared anywhere, by name or by definition', () => {
    const cs: JsonObject = {
      resourceType: 'CapabilityStatement',
      rest: [
        {
          // system level, by name
          operation: [op('expand', 'http://hl7.org/fhir/OperationDefinition/ValueSet-expand')],
          resource: [
            // on a resource, by name
            { type: 'ConceptMap', operation: [op('translate', 'http://hl7.org/fhir/OperationDefinition/ConceptMap-translate')] },
            {
              type: 'CodeSystem',
              operation: [
                // a name that isn't the standard one, but the standard definition
                op('cs-validate', 'http://hl7.org/fhir/OperationDefinition/CodeSystem-validate-code|5.0.0'),
                op('lookup', 'http://hl7.org/fhir/OperationDefinition/CodeSystem-lookup'),
              ],
            },
          ],
        },
      ],
    };
    expect(featuresFor(cs)).toEqual(new Set(['expand', 'translate', 'validate', 'lookup']));
  });

  it('closure, subsumes and related are features; compare is not', () => {
    const cs: JsonObject = {
      rest: [
        {
          operation: [
            op('closure', 'http://hl7.org/fhir/OperationDefinition/ConceptMap-closure'),
            op('subsumes', 'http://hl7.org/fhir/OperationDefinition/CodeSystem-subsumes'),
            op('related', 'http://hl7.org/fhir/OperationDefinition/ValueSet-related'),
            op('compare', 'http://hl7.org/fhir/tools/OperationDefinition/ValueSet-compare'),
          ],
        },
      ],
    };
    expect(featuresFor(cs)).toEqual(new Set(['closure', 'subsumes', 'related']));
  });

  it('tx-resource comes from the CodeSystemAsParameter feature, when true', () => {
    const yes: JsonObject = {
      extension: [
        feature('http://hl7.org/fhir/uv/tx-tests/FeatureDefinition/test-version', { valueCode: '1.9.6' }),
        feature(CODESYSTEM_AS_PARAMETER, { valueBoolean: true }),
      ],
    };
    expect(featuresFor(yes)).toEqual(new Set(['tx-resource']));
    const no: JsonObject = { extension: [feature(CODESYSTEM_AS_PARAMETER, { valueBoolean: false })] };
    expect(featuresFor(no)).toEqual(new Set());
  });

  it('nothing declared, no features', () => {
    expect(featuresFor({ resourceType: 'CapabilityStatement' })).toEqual(new Set());
    expect(featuresFor(undefined)).toEqual(new Set());
  });
});

describe('neededFeatures', () => {
  it('is the comma separated "feature" of a suite or test', () => {
    expect(neededFeatures(undefined)).toEqual([]);
    expect(neededFeatures({})).toEqual([]);
    expect(neededFeatures({ feature: '' })).toEqual([]);
    expect(neededFeatures({ feature: 'closure' })).toEqual(['closure']);
    expect(neededFeatures({ feature: ' expand , tx-resource ' })).toEqual(['expand', 'tx-resource']);
    expect(neededFeatures({ feature: ',expand,,validate,' })).toEqual(['expand', 'validate']);
  });
});

describe('featureGate', () => {
  const server = new Set(['expand', 'lookup']);
  it('is null when the server declares everything the suite and test need', () => {
    expect(featureGate({ feature: 'expand' }, { feature: 'lookup' }, server)).toBeNull();
    expect(featureGate({}, {}, server)).toBeNull();
  });
  it('names what is missing and what the server declares', () => {
    expect(featureGate({ feature: 'closure' }, { feature: 'translate,closure' }, server)).toBe(
      'needs the feature(s) [closure, translate], and the server only declares [expand, lookup]',
    );
  });
});
