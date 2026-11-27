import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';

const labPages = Object.fromEntries(
  readdirSync(resolve(__dirname, 'lab'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => ['lab_' + f.replace('.html', ''), resolve(__dirname, 'lab', f)]),
);

export default defineConfig({
  server: { host: '127.0.0.1', port: 5300, strictPort: true, hmr: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), ...labPages } },
  },
});
