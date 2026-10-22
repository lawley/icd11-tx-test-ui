import { describe, expect, it } from 'vitest';
import { skipReason } from './runner';
import type { SuiteDef, TestDef } from './tests';

const suite: SuiteDef = { name: 's', tests: [] };
const test = (t: Partial<TestDef>): TestDef => ({ name: 't', operation: 'lookup', ...t });

describe('skipReason', () => {
  it('skips a test whose feature the server does not declare', () => {
    const r = skipReason(suite, test({ feature: 'translate' }), new Set(), '5.0.0', new Set(['lookup']));
    expect(r).toMatch(/needs the feature\(s\) \[translate\]/);
  });
  it('runs a test whose feature the server declares', () => {
    expect(skipReason(suite, test({ feature: 'translate' }), new Set(), '5.0.0', new Set(['translate']))).toBeNull();
  });
});
