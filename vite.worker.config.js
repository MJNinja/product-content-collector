import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome110',
    lib: {
      entry: 'src/background/service-worker.js',
      formats: ['es'],
      fileName: () => 'service-worker.js',
    },
  },
});
