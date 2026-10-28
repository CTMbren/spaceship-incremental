import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };
const sha = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev'; // no git (or CI without history): the menu just omits it
  }
})();

// Relative base so the build works on GitHub Pages project sites (/spaceship-incremental/).
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(sha),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
  test: {
    include: ['tests/**/*.test.ts'],
    define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_SHA__: '"dev"', __BUILD_DATE__: '""' },
  },
});
