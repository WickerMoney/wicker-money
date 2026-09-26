import { defineConfig } from 'vitest/config'

/**
 * Integration configuration: every `*.integration.test.ts` file, against a real
 * PostgreSQL instance (see `src/testing/harness.ts` and the README for the
 * `TEST_*` connection variables).
 */
export default defineConfig({
  test: {
    globals: false,
    include: ['src/**/*.integration.test.ts'],
    // Integration tests share one Postgres database. Running files in parallel
    // would let one suite's cleanup delete another's fixtures mid-assertion.
    fileParallelism: false,
    globalSetup: ['./src/testing/global-setup.ts'],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
})
