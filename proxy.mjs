// Forwarding proxy: /__proxy/<encoded absolute url> is sent on server-side.
// Used by the Vite dev/preview server (vite.config.ts) and by server.mjs in
// production. Avoids CORS and mixed content (tx.fhir.org is http), and - unlike
// fetch - sends *no* Accept-Language, as the Java test runner does. Browsers always
// add one, which servers may echo (e.g. a displayLanguage expansion parameter).
// The client passes the language it really wants as X-Tx-Accept-Language.
import http from 'node:http';
import https from 'node:https';

export const PROXY_PREFIX = '/__proxy/';
const FORWARD = new Set(['accept', 'content-type', 'authorization', 'cache-control']);
// x-* headers set by tests are forwarded; infrastructure ones (App Service, proxies) are not
const INFRA_X = /^x-(tx-accept-language|forwarded|arr|ms-|client|waws|site|original|real-ip|appservice)/;
const DROP_RES = new Set(['transfer-encoding', 'connection', 'set-cookie', 'access-control-allow-origin', 'access-control-allow-credentials', 'content-security-policy', 'x-content-type-options']);
// The client only reads JSON; anything else (HTML, XML, SVG...) is served as text so an
// upstream page can never run script on our origin.
const SAFE_TYPE = /^\s*(application\/([\w.-]+\+)?json|text\/plain)\s*(;|$)/i;
const DEFAULT_HOSTS = 'icdapi-fhir-testing-byfzd6budwdmbabf.northeurope-01.azurewebsites.net,tx.fhir.org,r4.ontoserver.csiro.au';

/** PROXY_ALLOW_HOSTS (comma-separated, '*' = any) or the default hosts; undefined means any. */
export function allowHostsFromEnv(env = process.env) {
  const hosts = (env.PROXY_ALLOW_HOSTS ?? DEFAULT_HOSTS).trim();
  return hosts === '*' ? undefined : hosts.split(',').map((h) => h.trim()).filter(Boolean);
}

/** Only the app's own fetch may use the proxy: no navigations, frames or cross-site requests. */
function crossSite(req) {
  const site = req.headers['sec-fetch-site'];
  return req.headers['sec-fetch-mode'] === 'navigate' || (site !== undefined && site !== 'same-origin');
}

/**
 * @param {{ allowHosts?: string[] }} [opts] if allowHosts is given, only those hosts may be targeted
 * @returns {(req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void}
 */
export function proxyMiddleware(opts = {}) {
  const allow = opts.allowHosts?.length ? new Set(opts.allowHosts.map((h) => h.toLowerCase())) : null;
  return (req, res, next) => {
    if (!req.url?.startsWith(PROXY_PREFIX)) return next();
    if (crossSite(req)) {
      res.statusCode = 403;
      res.setHeader('content-type', 'text/plain');
      res.end('Proxy is same-origin only');
      return;
    }
    let target;
    try {
      target = new URL(decodeURIComponent(req.url.slice(PROXY_PREFIX.length)));
      if (!/^https?:$/.test(target.protocol)) throw new Error('bad protocol');
    } catch {
      res.statusCode = 400;
      res.end('Bad proxy target');
      return;
    }
    if (allow && !allow.has(target.hostname.toLowerCase())) {
      res.statusCode = 403;
      res.setHeader('content-type', 'text/plain');
      res.end(`Proxy target host not allowed: ${target.hostname}`);
      return;
    }
    /** @type {Record<string, string>} */
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v !== 'string') continue;
      if (FORWARD.has(k) || (k.startsWith('x-') && !INFRA_X.test(k))) headers[k] = v;
    }
    const lang = req.headers['x-tx-accept-language'];
    if (typeof lang === 'string' && lang) headers['accept-language'] = lang;

    const lib = target.protocol === 'https:' ? https : http;
    const upstream = lib.request(target, { method: req.method, headers, timeout: 120_000 }, (ur) => {
      res.statusCode = ur.statusCode ?? 502;
      for (const [k, v] of Object.entries(ur.headers)) {
        if (v !== undefined && !DROP_RES.has(k)) res.setHeader(k, v);
      }
      if (!SAFE_TYPE.test(ur.headers['content-type'] ?? '')) res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('content-security-policy', "sandbox; default-src 'none'");
      ur.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
    upstream.on('error', (e) => {
      if (res.headersSent) return res.end();
      res.statusCode = 502;
      res.setHeader('content-type', 'text/plain');
      res.end(`Proxy error: ${e.message}`);
    });
    req.pipe(upstream);
  };
}
