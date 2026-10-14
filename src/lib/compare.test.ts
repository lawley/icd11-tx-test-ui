import { describe, expect, it } from 'vitest';
import { compareJson, type CompareContext, type Json } from './compare';
import { normaliseActual } from './normalise';
import { align } from './align';

const ctx = (modes: string[] = [], version = '4.0.1', externals: Record<string, string> | null = null): CompareContext => ({
  modes: new Set(modes),
  externals,
  variables: { version },
});

const ok = (e: Json, a: Json, c = ctx()) => compareJson(e, a, c);

describe('templates', () => {
  it('type templates', () => {
    expect(ok({ a: '$uuid$' }, { a: 'urn:uuid:12345678-1234-1234-1234-123456789abc' }).pass).toBe(true);
    expect(ok({ a: '$uuid$' }, { a: 'http://x' }).pass).toBe(false);
    expect(ok({ a: '$instant$' }, { a: '2026-10-14T01:02:03.456Z' }).pass).toBe(true);
    expect(ok({ a: '$instant$' }, { a: '2026-10-14' }).pass).toBe(false);
    expect(ok({ a: '$date$' }, { a: '2026-01' }).pass).toBe(false);
    expect(ok({ a: '$id$' }, { a: 'abc-1.2' }).pass).toBe(true);
    expect(ok({ a: '$string$' }, { a: ' x' }).pass).toBe(false);
    expect(ok({ a: '$$' }, { a: 'anything' }).pass).toBe(true);
  });

  it('choice, fragments, external', () => {
    expect(ok({ a: '$choice:x|y$' }, { a: 'y' }).pass).toBe(true);
    expect(ok({ a: '$fragments:Foo|bar$' }, { a: 'a FOO and a BAR' }).pass).toBe(true);
    expect(ok({ a: '$external:1:XXXX9$' }, { a: "Unknown code 'XXXX9'" }).pass).toBe(true);
    expect(ok({ a: '$external:1:XXXX9$' }, { a: 'nope' }).pass).toBe(false);
    expect(ok({ a: '$external:1:XXXX9$' }, { a: 'exact' }, ctx([], '4.0.1', { '1': 'exact' })).pass).toBe(true);
    expect(ok({ a: '$external:1$' }, { a: 'whatever' }).pass).toBe(true);
  });

  it('$version$ substitution', () => {
    expect(ok({ a: 'http://x|$version$' }, { a: 'http://x|4.0.1' }).pass).toBe(true);
    expect(ok({ a: '$version$' }, { a: '5.0.0' }).pass).toBe(false);
  });
});

describe('objects', () => {
  it('unexpected and missing properties', () => {
    const r = ok({ a: 1, b: 2 }, { a: 1, c: 3 });
    expect(r.pass).toBe(false);
    expect(r.diffs.map((d) => d.message)).toEqual(['unexpected property c', 'missing property b']);
  });

  it('$optional-properties$', () => {
    expect(ok({ '$optional-properties$': ['id'], a: 1, id: 'x' }, { a: 1 }).pass).toBe(true);
    expect(ok({ '$optional-properties$': ['id'], a: 1 }, { a: 1, id: 'y' }).pass).toBe(true);
    // '*' lets anything be omitted, but (as in Java) does not admit extras
    expect(ok({ '$optional-properties$': ['*'], a: 1, b: 2 }, { a: 1 }).pass).toBe(true);
    expect(ok({ '$optional-properties$': ['*'], a: 1 }, { a: 1, z: 1 }).pass).toBe(false);
  });
});

describe('arrays', () => {
  const ext = { $optional$: '!tx.fhir.org', url: 'u', valueString: 'v' };
  it('$optional$ mode filter', () => {
    expect(ok({ x: [{ a: 1 }, ext] }, { x: [{ a: 1 }] }).pass).toBe(true);
    expect(ok({ x: [{ a: 1 }, ext] }, { x: [{ a: 1 }] }, ctx(['tx.fhir.org'])).pass).toBe(false);
    expect(ok({ x: [{ a: 1 }, ext] }, { x: [{ a: 1 }, { url: 'u', valueString: 'v' }] }).pass).toBe(true);
  });

  it('array of only-optional items may be absent', () => {
    expect(ok({ a: 1, x: [{ $optional$: true, b: 1 }] }, { a: 1 }).pass).toBe(true);
  });

  it('$only$ prohibits outside its filter', () => {
    const e: Json = { x: [{ a: 1 }, { $only$: 'version:4', b: 2 }] };
    expect(ok(e, { x: [{ a: 1 }, { b: 2 }] }, ctx([], '4.0.1')).pass).toBe(true);
    expect(ok(e, { x: [{ a: 1 }] }, ctx([], '4.0.1')).pass).toBe(false);
    const r = ok(e, { x: [{ a: 1 }, { b: 2 }] }, ctx([], '5.0.0'));
    expect(r.pass).toBe(false);
    expect(r.diffs[0].message).toMatch(/prohibited/);
    expect(ok(e, { x: [{ a: 1 }] }, ctx([], '5.0.0')).pass).toBe(true);
  });

  it('$count-arrays$', () => {
    const e = { '$optional-properties$': [], '$count-arrays$': ['x'], x: [1, 2] };
    expect(ok(e, { x: [9, 8] }).pass).toBe(true);
    expect(ok(e, { x: [9] }).pass).toBe(false);
  });

  it('collects several diffs', () => {
    const r = ok({ x: [{ a: 1 }, { a: 2 }] }, { x: [{ a: 9 }, { a: 8 }] });
    expect(r.diffs).toHaveLength(2);
  });
});

describe('pattern mode', () => {
  it('only looks for expected items', () => {
    const c = { ...ctx(), patternMode: true };
    expect(compareJson({ cs: [{ uri: 'b' }] }, { cs: [{ uri: 'a' }, { uri: 'b' }], other: 1 }, c).pass).toBe(true);
    expect(compareJson({ cs: [{ uri: 'z' }] }, { cs: [{ uri: 'a' }] }, c).pass).toBe(false);
  });
});

describe('normaliseActual', () => {
  it('scrubs diagnostics + meta, sorts params; Parameters-level extensions kept (as Java)', () => {
    const n = normaliseActual(
      {
        resourceType: 'Parameters',
        meta: { lastUpdated: 'x' },
        parameter: [
          { name: 'version', valueString: '1' },
          { name: 'property', part: [{ name: 'value', valueCode: 'b' }, { name: 'code', valueCode: 'parent' }] },
          { name: 'property', part: [{ name: 'code', valueCode: 'id' }, { name: 'value', valueCode: 'a' }] },
          { name: 'code', valueCode: 'X', extension: [{ url: 'http://other', valueString: 'q' }] },
        ],
      },
      '5.0.0',
    ) as { parameter: { name: string; part?: { name: string }[]; extension?: unknown }[] };
    expect(n.parameter.map((p) => p.name)).toEqual(['code', 'property', 'property', 'version']);
    expect(n.parameter[0].extension).toBeDefined();
    expect(n.parameter[1].part?.map((p) => p.name)).toEqual(['code', 'value']);
    expect(JSON.stringify(n)).not.toContain('meta');
  });

  it('OO: drops diagnostics; keeps message-id extension', () => {
    const n = normaliseActual(
      {
        resourceType: 'OperationOutcome',
        text: { div: '<div/>' },
        issue: [
          {
            extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/operationoutcome-message-id', valueString: 'm' }],
            severity: 'error',
            code: 'not-found',
            diagnostics: 'stack',
            details: { text: 't' },
          },
        ],
      },
      '4.0.1',
    );
    expect(n).toEqual({
      resourceType: 'OperationOutcome',
      issue: [
        {
          extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/operationoutcome-message-id', valueString: 'm' }],
          severity: 'error',
          code: 'not-found',
          details: { text: 't' },
        },
      ],
    });
  });

  it('R4 contains.property extension -> R5 property', () => {
    const n = normaliseActual(
      {
        resourceType: 'ValueSet',
        expansion: {
          contains: [
            {
              code: 'B',
              extension: [
                {
                  url: 'http://hl7.org/fhir/5.0/StructureDefinition/extension-ValueSet.expansion.contains.property',
                  extension: [{ url: 'code', valueCode: 'parent' }, { url: 'value', valueCode: 'A' }],
                },
              ],
            },
            { code: 'A' },
          ],
        },
      },
      '4.0.1',
    );
    expect(n).toEqual({
      resourceType: 'ValueSet',
      expansion: { contains: [{ code: 'A' }, { code: 'B', property: [{ code: 'parent', valueCode: 'A' }] }] },
    });
  });
});

describe('align', () => {
  it('lines up by identity and flags volatile rows', () => {
    const expected = {
      resourceType: 'ValueSet',
      expansion: { identifier: '$uuid$', contains: [{ code: 'A', display: 'a' }, { code: 'B', display: 'b' }] },
    };
    const rows = align(expected, [
      { id: 's1', actual: { resourceType: 'ValueSet', expansion: { identifier: 'urn:uuid:11111111-1111-1111-1111-111111111111', contains: [{ code: 'A', display: 'a' }, { code: 'B', display: 'b' }] } }, ctx: ctx() },
      { id: 's2', actual: { resourceType: 'ValueSet', expansion: { identifier: 'urn:uuid:22222222-2222-2222-2222-222222222222', contains: [{ code: 'B', display: 'bee' }] } }, ctx: ctx() },
    ]);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey['.expansion.identifier'].volatile).toBe(true);
    expect(byKey['.expansion.identifier'].interesting).toBe(false);
    expect(byKey['.expansion.contains[B].display'].cells.s2.status).toBe('mismatch');
    expect(byKey['.expansion.contains[A].code'].cells.s2.status).toBe('missing');
    expect(byKey['.resourceType'].interesting).toBe(false);
  });
});
