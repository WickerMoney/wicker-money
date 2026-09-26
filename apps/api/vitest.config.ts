import { configDefaults, defineConfig } from 'vitest/config'

/**
 * Unit configuration: pure logic and services over mocked repositories. Needs
 * no database, so it is what `pnpm test` (and the CI gate) runs.
 *
 * Tests that talk to PostgreSQL are named `*.integration.test.ts` and run under
 * `vitest.integration.config.ts` (`pnpm test:integration`).
 */
export default defineConfig({
  test: {
    globals: false,
    exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
  },
})
