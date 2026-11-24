import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome110',
    lib: {
      entry: 'src/content/content.js',
      formats: ['iife'],
      name: 'ProductContentCollectorContent',
      fileName: () => 'content.js',
    },
  },
});
