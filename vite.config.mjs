import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./client', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@imagemagick/magick-wasm', '@jsquash/oxipng'] },
  server: { host: '127.0.0.1', port: 4173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001' } },
  build: { outDir: '../dist', emptyOutDir: true,
    rolldownOptions: { input: { process: fileURLToPath(new URL('./client/process/index.html', import.meta.url)) } },
  },
});
