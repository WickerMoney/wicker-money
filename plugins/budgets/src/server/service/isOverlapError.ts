/** The unique index that allows one line per category per start day (migration 011). */
const ONE_LINE_PER_START = 'ux_budget_lines_user_category_period'

/**
 * Tests whether a driver error means a write would give a category two budget
 * lines covering the same day.
 *
 * That is PostgreSQL's exclusion violation (`23P01`), and also the unique
 * violation (`23505`) on the one-line-per-start-day index: two lines that begin
 * on the same day overlap by definition, and the database checks that index
 * first, so the exclusion constraint never gets to refuse them.
 *
 * Duck-typed on `code` and `constraint`, so it works with any driver's error
 * shape and with the in-memory repositories the service tests use.
 *
 * @param error - Anything thrown by a repository call.
 * @returns `true` for an overlap.
 */
export function isOverlapError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  if (error.code === '23P01') return true
  if (error.code !== '23505') return false
  const name = 'constraint' in error ? error.constraint : 'constraint_name' in error ? error.constraint_name : undefined
  return typeof name === 'string' && name.endsWith(ONE_LINE_PER_START)
}
