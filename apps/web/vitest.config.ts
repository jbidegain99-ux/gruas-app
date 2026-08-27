import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // e2e/ holds Playwright specs - vitest must not try to collect them
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'e2e/**'],
    // No unit tests here yet - don't fail the workspace-wide `pnpm test`.
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
