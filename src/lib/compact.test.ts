import { describe, expect, it } from 'vitest';
import { compactRequest } from './compact';

describe('compactRequest', () => {
  it('parameters', () => {
    expect(
      compactRequest({
        resourceType: 'Parameters',
        parameter: [
          { name: 'url', valueUri: 'http://x/vs' },
          { name: 'count', valueInteger: 5 },
          { name: 'coding', valueCoding: { system: 'http://s', version: '1', code: 'c', display: 'C' } },
          { name: 'valueSet', resource: { resourceType: 'ValueSet', url: 'http://x/vs2', version: '2' } },
          { name: 'property', part: [{ name: 'code', valueCode: 'p' }] },
        ],
      }),
    ).toEqual([
      'url = http://x/vs',
      'count = 5',
      'coding = http://s|c (v1) "C"',
      'valueSet = ValueSet http://x/vs2|2',
      'property:',
      '  code = p',
    ]);
  });

  it('batch bundle', () => {
    expect(
      compactRequest({
        resourceType: 'Bundle',
        entry: [{ request: { method: 'POST', url: 'CodeSystem/$validate-code' }, resource: { resourceType: 'Parameters', parameter: [{ name: 'code', valueCode: 'a' }] } }],
      }),
    ).toEqual(['entry 1: POST CodeSystem/$validate-code', '  code = a']);
  });
});
