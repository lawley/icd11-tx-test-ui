import { describe, expect, it } from 'vitest';
import { sortParameters } from './normalise';
import type { JsonObject } from './compare';

const names = (list: unknown) => ((list ?? []) as JsonObject[]).map((p) => p.name);
const parts = (p: JsonObject) => p.part as JsonObject[];
const part = (p: JsonObject, name: string) => parts(p).find((x) => x.name === name);

// Ports of TxTesterSortersTests, plus the property sort value rules (org.hl7.fhir.core 7.0.3)
describe('sortParameters: parts sorted at every level', () => {
  it('sorts the parts of a lone parameter, and of a lone part', () => {
    const only: JsonObject = {
      name: 'only',
      part: [
        { name: 'b', part: [{ name: 'lone', part: [{ name: 'q' }, { name: 'p' }] }] },
        { name: 'a', part: [{ name: 'z' }, { name: 'y' }] },
      ],
    };
    sortParameters({ resourceType: 'Parameters', parameter: [only] });
    expect(names(only.part)).toEqual(['a', 'b']);
    expect(names(parts(only)[0].part)).toEqual(['y', 'z']);
    expect(names(parts(parts(only)[1])[0].part)).toEqual(['p', 'q']);
  });

  it('sorts subproperties by code, as properties are', () => {
    const first: JsonObject = {
      name: 'first',
      part: [
        {
          name: 'property',
          part: [
            { name: 'subproperty', part: [{ name: 'code', valueCode: 'zeta' }] },
            { name: 'subproperty', part: [{ name: 'code', valueCode: 'alpha' }] },
            { name: 'code', valueCode: 'c' },
          ],
        },
      ],
    };
    const po: JsonObject = { resourceType: 'Parameters', parameter: [{ name: 'second', part: [{ name: 'x' }] }, first] };
    sortParameters(po);
    expect(names(po.parameter)).toEqual(['first', 'second']);
    const prop = parts(parts(first)[0]);
    expect(names(prop)).toEqual(['code', 'subproperty', 'subproperty']);
    expect(part(prop[1], 'code')?.valueCode).toBe('alpha');
    expect(part(prop[2], 'code')?.valueCode).toBe('zeta');
  });
});

describe('sortParameters: what a property sorts by after its code', () => {
  const property = (code: string, ...rest: JsonObject[]): JsonObject => ({ name: 'property', part: [{ name: 'code', valueCode: code }, ...rest] });
  const sub = (code: string, value: string): JsonObject => ({
    name: 'subproperty',
    part: [{ name: 'code', valueCode: code }, { name: 'value', valueString: value }],
  });

  it('a property with no value sorts by its subproperties (ICD-11 postcoordination)', () => {
    const po: JsonObject = {
      parameter: [
        property('postcoordination', sub('code', 'XK9J'), sub('axis', 'laterality')),
        property('postcoordination', sub('code', 'XH1'), sub('axis', 'histopathology')),
      ],
    };
    sortParameters(po);
    // axis=histopathology;code=xh1; < axis=laterality;code=xk9j;
    const firstAxis = part(parts((po.parameter as JsonObject[])[0])[1], 'value');
    expect(firstAxis?.valueString).toBe('histopathology');
  });

  it('a Coding value sorts as system|code', () => {
    const po: JsonObject = {
      parameter: [
        property('parent', { name: 'value', valueCoding: { system: 'http://b', code: '1' } }),
        property('parent', { name: 'value', valueCoding: { system: 'http://a', code: '2' } }),
      ],
    };
    sortParameters(po);
    expect((part((po.parameter as JsonObject[])[0], 'value')?.valueCoding as JsonObject).system).toBe('http://a');
  });

  it('a property with no value sorts before one with a value', () => {
    const po: JsonObject = {
      parameter: [property('x', { name: 'value', valueString: 'v' }), property('x')],
    };
    sortParameters(po);
    expect(part((po.parameter as JsonObject[])[0], 'value')).toBeUndefined();
  });

  it('a designation with no value sorts before one with a value', () => {
    const designation = (...rest: JsonObject[]): JsonObject => ({ name: 'designation', part: [{ name: 'language', valueCode: 'en' }, ...rest] });
    const po: JsonObject = { parameter: [designation({ name: 'value', valueString: 'v' }), designation()] };
    sortParameters(po);
    expect(part((po.parameter as JsonObject[])[0], 'value')).toBeUndefined();
  });
});
