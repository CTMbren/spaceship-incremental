import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages project sites (/spaceship-incremental/).
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
  test: { include: ['tests/**/*.test.ts'] },
});
