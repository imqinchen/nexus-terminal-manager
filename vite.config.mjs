import { defineConfig } from 'vite';

export default defineConfig({
  // Electron loads the production renderer with file://, so assets must be
  // resolved relative to dist/index.html instead of the filesystem root.
  base: './',
});
