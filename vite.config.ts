import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { txProxy } from './proxy.ts';

export default defineConfig({
  plugins: [react(), txProxy()],
});
