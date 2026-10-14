import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { proxyMiddleware } from './proxy.mjs';

function txProxy(): Plugin {
  return {
    name: 'tx-proxy',
    configureServer: (server) => void server.middlewares.use(proxyMiddleware()),
    configurePreviewServer: (server) => void server.middlewares.use(proxyMiddleware()),
  };
}

export default defineConfig({
  plugins: [react(), txProxy()],
});
