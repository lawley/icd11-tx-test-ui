// Production server for App Service: serves dist/ and the proxy. No dependencies.
//   PORT               port to listen on (App Service sets it)
//   PROXY_ALLOW_HOSTS  comma-separated hosts the proxy may reach; '*' allows any
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowHostsFromEnv, proxyMiddleware } from './proxy.mjs';

const allowHosts = allowHostsFromEnv();

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const proxy = proxyMiddleware({ allowHosts });

async function serveStatic(req, res) {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(root, path));
  if (file !== root && !file.startsWith(root + sep)) {
    res.statusCode = 403;
    return res.end();
  }
  let s = await stat(file).catch(() => null);
  if (s?.isDirectory()) {
    file = join(file, 'index.html');
    s = await stat(file).catch(() => null);
  }
  if (!s) {
    file = join(root, 'index.html'); // SPA fallback
    s = await stat(file).catch(() => null);
    if (!s) {
      res.statusCode = 404;
      return res.end('Not found - was the app built?');
    }
  }
  res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.setHeader('cache-control', file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  createReadStream(file).pipe(res);
}

const port = Number(process.env.PORT ?? 8080);
http
  .createServer((req, res) => {
    proxy(req, res, () => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405;
        return res.end();
      }
      serveStatic(req, res).catch((e) => {
        res.statusCode = 500;
        res.end(String(e));
      });
    });
  })
  .listen(port, () => {
    console.log(`listening on ${port}; proxy hosts: ${allowHosts?.join(', ') ?? 'any'}`);
  });
