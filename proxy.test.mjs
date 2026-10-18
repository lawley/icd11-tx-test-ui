import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allowHostsFromEnv, proxyMiddleware, PROXY_PREFIX } from './proxy.mjs';

/** @param {http.RequestListener} handler */
const listen = (handler) =>
  new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
/** @param {http.Server} s */
const port = (s) => /** @type {import('node:net').AddressInfo} */ (s.address()).port;

/** @type {http.Server} */ let upstream;
/** @type {http.Server} */ let proxy;

beforeAll(async () => {
  upstream = await listen((req, res) => {
    const type = new URL(req.url ?? '/', 'http://x').searchParams.get('type') ?? 'application/fhir+json';
    res.setHeader('content-type', type);
    res.setHeader('content-security-policy', 'script-src *');
    res.end('<script>alert(1)</script>');
  });
  const mw = proxyMiddleware({ allowHosts: ['127.0.0.1'] });
  proxy = await listen((req, res) => mw(req, res, () => res.end('next')));
});
afterAll(() => {
  upstream.close();
  proxy.close();
});

// http.get rather than fetch, which overrides sec-fetch-mode
/** @param {string} target @param {Record<string, string>} [headers] @returns {Promise<{ status: number, type: string | undefined, headers: http.IncomingHttpHeaders }>} */
const get = (target, headers = {}) =>
  new Promise((resolve, reject) => {
    const url = `http://127.0.0.1:${port(proxy)}${PROXY_PREFIX}${encodeURIComponent(target)}`;
    http.get(url, { headers }, (r) => {
      r.resume();
      resolve({ status: r.statusCode ?? 0, type: r.headers['content-type'], headers: r.headers });
    }).on('error', reject);
  });
const up = (type = 'application/fhir+json') => `http://127.0.0.1:${port(upstream)}/?type=${encodeURIComponent(type)}`;

describe('proxy', () => {
  it('forwards same-origin fetches, keeping JSON content types', async () => {
    const r = await get(up('application/fhir+json; fhirVersion=5.0'), { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' });
    expect(r.status).toBe(200);
    expect(r.type).toBe('application/fhir+json; fhirVersion=5.0');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
  });

  it('serves non-JSON responses as text/plain', async () => {
    for (const t of ['text/html', 'application/xhtml+xml', 'image/svg+xml', 'application/fhir+xml', 'application/jsonx']) {
      expect((await get(up(t))).type).toBe('text/plain; charset=utf-8');
    }
  });

  it('rejects navigations and cross-site requests', async () => {
    expect((await get(up(), { 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-origin' })).status).toBe(403);
    expect((await get(up(), { 'sec-fetch-mode': 'no-cors', 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await get(up(), { 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-site' })).status).toBe(403);
  });

  it('rejects hosts not on the allowlist', async () => {
    expect((await get(`http://localhost:${port(upstream)}/`)).status).toBe(403);
  });

  it('reads the allowlist from PROXY_ALLOW_HOSTS', () => {
    expect(allowHostsFromEnv({})).toContain('tx.fhir.org');
    expect(allowHostsFromEnv({ PROXY_ALLOW_HOSTS: ' a.org, b.org ' })).toEqual(['a.org', 'b.org']);
    expect(allowHostsFromEnv({ PROXY_ALLOW_HOSTS: '*' })).toBeUndefined();
  });
});
