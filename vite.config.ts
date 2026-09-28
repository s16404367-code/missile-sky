/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// IMPORTANT for GitHub Pages:
// `base: './'` makes every asset reference RELATIVE, so the game works both at
// https://user.github.io/ and at https://user.github.io/<repo-name>/ without
// any hard-coded absolute paths.
export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    assetsDir: 'assets',
    // Single chunk keeps things simple and cache-friendly for a small game.
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
