import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { allowHostsFromEnv, proxyMiddleware } from './proxy.mjs';

// Same host allowlist as server.mjs (PROXY_ALLOW_HOSTS)
function txProxy(): Plugin {
  const allowHosts = allowHostsFromEnv();
  return {
    name: 'tx-proxy',
    configureServer: (server) => void server.middlewares.use(proxyMiddleware({ allowHosts })),
    configurePreviewServer: (server) => void server.middlewares.use(proxyMiddleware({ allowHosts })),
  };
}

export default defineConfig({
  plugins: [react(), txProxy()],
});
