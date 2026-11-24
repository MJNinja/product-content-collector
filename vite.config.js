import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// Main build: the side panel page (React). The content script and the
// service worker are built separately (vite.content.config.js,
// vite.worker.config.js) as single self-contained files, because content
// scripts injected with chrome.scripting cannot use ES module imports.
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'emit-manifest',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'manifest.json',
          source: readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'),
        });
      },
    },
  ],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome110',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: { sidepanel: 'index.html' },
    },
  },
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost:3000/' } },
    include: ['tests/unit/**/*.test.js'],
    setupFiles: ['tests/unit/setup.js'],
  },
});
