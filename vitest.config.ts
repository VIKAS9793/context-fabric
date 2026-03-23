// vitest.config.ts
// VERIFIED: Vitest 4.1.0 (npmjs.com/package/vitest, March 2026)
// VERIFIED: pool 'forks' required for better-sqlite3 native module stability
//           Source: vitest.dev/config/pool
// NOTE: Vitest 4 removed poolOptions — options are now top-level
//       Source: vitest.dev/guide/migration#vitest-4

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    pool:        'forks',       // child_process — safe for native addons
    include:     ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include:  ['src/**/*.ts'],
      exclude:  ['src/index.ts', 'src/cli.ts'],  // entry points, not logic
    },
  },
});
