/**
 * Tests whether a driver error is PostgreSQL's violation `code` of the named
 * constraint.
 *
 * Duck-typed on `code` and `constraint`, so it works with any driver's error
 * shape and with the in-memory repositories the service tests use.
 *
 * @param error - Anything thrown by a repository call.
 * @param code - The SQLSTATE, such as `'23505'` for a unique violation.
 * @param constraint - The constraint or index name.
 * @returns `true` if it is that violation.
 */
export function isConstraintError(error: unknown, code: string, constraint: string): boolean {
  return (
    typeof error === 'object' && error !== null &&
    'code' in error && error.code === code &&
    'constraint' in error && error.constraint === constraint
  )
}
