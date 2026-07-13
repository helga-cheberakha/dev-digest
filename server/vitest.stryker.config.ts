import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Scoped config for mutation testing (server/stryker.conf.json) — same aliases as the base
// config, but `include` is narrowed to just the scoring test so a mutation run over
// `scoring.ts` doesn't drag in the whole suite (incl. testcontainers-based integration tests).
export default defineConfig({
  resolve: {
    alias: {
      '@devdigest/shared': path.resolve(__dirname, 'src/vendor/shared'),
      '@devdigest/reviewer-core': path.resolve(__dirname, '../reviewer-core/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/modules/eval/scoring.test.ts'],
  },
});
