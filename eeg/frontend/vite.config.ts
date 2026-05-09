import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

const portConfigPath = path.resolve(__dirname, '..', 'config', 'ports.json');
const portConfig = JSON.parse(fs.readFileSync(portConfigPath, 'utf8')) as {
  host: string;
  frontend: number;
  backend: number;
};

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: portConfig.host,
    port: portConfig.frontend,
    proxy: {
      '/api': `http://${portConfig.host}:${portConfig.backend}`,
      '/ws': { target: `ws://${portConfig.host}:${portConfig.backend}`, ws: true },
      '/audio': `http://${portConfig.host}:${portConfig.backend}`,
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
