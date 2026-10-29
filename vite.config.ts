import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Three static pages. Each lives in its own directory so the URLs are
 * /, /whats-on/ and /about/ on any static host, with no rewrite rules.
 */
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        whatsOn: resolve(import.meta.dirname, 'whats-on/index.html'),
        about: resolve(import.meta.dirname, 'about/index.html'),
      },
    },
  },
});
