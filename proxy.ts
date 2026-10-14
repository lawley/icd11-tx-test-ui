import http from 'node:http';
import https from 'node:https';
import type { Connect, Plugin } from 'vite';

// Dev/preview proxy: /__proxy/<encoded absolute url> is forwarded server-side.
// Avoids CORS and mixed content (tx.fhir.org is http), and - unlike fetch - lets
// us send *no* Accept-Language, as the Java test runner does. Browsers always add
// one, which servers may echo (e.g. a displayLanguage expansion parameter).
// The client passes the language it really wants as X-Tx-Accept-Language.
const PREFIX = '/__proxy/';
const FORWARD = new Set(['accept', 'content-type', 'authorization', 'cache-control']);
const DROP_RES = new Set(['transfer-encoding', 'connection', 'set-cookie', 'access-control-allow-origin', 'access-control-allow-credentials']);

function middleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (!req.url?.startsWith(PREFIX)) return next();
    let target: URL;
    try {
      target = new URL(decodeURIComponent(req.url.slice(PREFIX.length)));
      if (!/^https?:$/.test(target.protocol)) throw new Error('bad protocol');
    } catch {
      res.statusCode = 400;
      res.end('Bad proxy target');
      return;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v !== 'string') continue;
      if (FORWARD.has(k) || (k.startsWith('x-') && k !== 'x-tx-accept-language')) headers[k] = v;
    }
    const lang = req.headers['x-tx-accept-language'];
    if (typeof lang === 'string' && lang) headers['accept-language'] = lang;

    const lib = target.protocol === 'https:' ? https : http;
    const upstream = lib.request(target, { method: req.method, headers, timeout: 120_000 }, (ur) => {
      res.statusCode = ur.statusCode ?? 502;
      for (const [k, v] of Object.entries(ur.headers)) {
        if (v !== undefined && !DROP_RES.has(k)) res.setHeader(k, v);
      }
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

export function txProxy(): Plugin {
  return {
    name: 'tx-proxy',
    configureServer(server) {
      server.middlewares.use(middleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware());
    },
  };
}
