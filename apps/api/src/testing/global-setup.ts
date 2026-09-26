import { migrateTestDatabase } from './harness.js'

/**
 * Vitest global setup: migrates the test database once before any test file
 * runs.
 *
 * @throws {Error} If the admin connection is a superuser or migration fails.
 */
export async function setup(): Promise<void> {
  await migrateTestDatabase()
}
