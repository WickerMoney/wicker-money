/**
 * Tests whether a driver error is PostgreSQL's exclusion violation (`23P01`):
 * a write that would give a category two budget lines covering the same day.
 *
 * Duck-typed on `code`, so it works with any driver's error shape and with the
 * in-memory repositories the service tests use.
 *
 * @param error - Anything thrown by a repository call.
 * @returns `true` for an exclusion violation.
 */
export function isOverlapError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23P01'
}
