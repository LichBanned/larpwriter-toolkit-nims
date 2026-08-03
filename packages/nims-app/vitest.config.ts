import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/stores/ApiStore.ts',
        'src/stores/AuthStore.ts',
        'src/stores/ProjectStore.ts',
        'src/stores/PermissionsStore.ts',
      ],
      thresholds: {
        lines: 70,
        branches: 55,
        functions: 55,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
