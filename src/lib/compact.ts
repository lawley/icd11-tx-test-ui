// One-line-per-parameter summary of a test request, for hover previews.
import { isObject, type Json, type JsonObject } from './compare';

const str = (v: Json | undefined) => (typeof v === 'string' ? v : '');

function coding(c: JsonObject): string {
  const sys = str(c.system);
  const ver = str(c.version);
  const code = str(c.code);
  const disp = str(c.display);
  return `${sys ? `${sys}|` : ''}${code}${ver ? ` (v${ver})` : ''}${disp ? ` "${disp}"` : ''}`;
}

/** Short label for an inline resource: type, canonical url|version or id. */
export function resourceLabel(r: Json): string {
  if (!isObject(r)) return String(r);
  const id = str(r.url) ? `${str(r.url)}${str(r.version) ? `|${str(r.version)}` : ''}` : str(r.id);
  return `${str(r.resourceType) || 'resource'}${id ? ` ${id}` : ''}`;
}

function value(p: JsonObject): string | undefined {
  for (const [k, v] of Object.entries(p)) {
    if (!k.startsWith('value')) continue;
    if (k === 'valueCoding' && isObject(v)) return coding(v);
    if (k === 'valueCodeableConcept' && isObject(v)) {
      const cs = ((v.coding as Json[] | undefined) ?? []).filter(isObject).map(coding);
      return [...cs, ...(str(v.text) ? [`text "${str(v.text)}"`] : [])].join(', ');
    }
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  return undefined;
}

function paramLines(params: Json[] | undefined, indent: string, out: string[]) {
  for (const p of params ?? []) {
    if (!isObject(p)) continue;
    const name = str(p.name);
    if (p.resource !== undefined) out.push(`${indent}${name} = ${resourceLabel(p.resource)}`);
    else if (Array.isArray(p.part)) {
      out.push(`${indent}${name}:`);
      paramLines(p.part, `${indent}  `, out);
    } else out.push(`${indent}${name} = ${value(p) ?? ''}`);
  }
}

/** Compact text form of a Parameters (or batch Bundle of Parameters) request. */
export function compactRequest(body: Json | undefined): string[] {
  const out: string[] = [];
  if (!isObject(body)) return out;
  if (body.resourceType === 'Parameters') paramLines(body.parameter as Json[], '', out);
  else if (body.resourceType === 'Bundle') {
    ((body.entry as Json[] | undefined) ?? []).forEach((e, i) => {
      if (!isObject(e)) return;
      const req = isObject(e.request) ? `${str(e.request.method)} ${str(e.request.url)}`.trim() : '';
      out.push(`entry ${i + 1}${req ? `: ${req}` : ''}`);
      if (isObject(e.resource)) paramLines(e.resource.parameter as Json[], '  ', out);
    });
  } else out.push(resourceLabel(body));
  return out;
}
