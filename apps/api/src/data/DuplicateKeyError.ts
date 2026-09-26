/**
 * Raised by a repository when a write violates a unique constraint.
 *
 * Repositories translate the driver's error into this type so that services
 * never depend on PostgreSQL error codes; a service decides what the
 * duplicate means to the caller (usually a `ConflictError` with a friendly
 * message).
 */
export class DuplicateKeyError extends Error {
  /**
   * @param constraint - Name of the violated constraint, when the driver reports it.
   * @param cause - The original driver error.
   */
  constructor(
    readonly constraint: string | undefined,
    override readonly cause: unknown,
  ) {
    super(`Unique constraint violated${constraint === undefined ? '' : `: ${constraint}`}.`)
    this.name = 'DuplicateKeyError'
  }
}
