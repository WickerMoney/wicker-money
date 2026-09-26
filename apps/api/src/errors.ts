/**
 * Base class for errors the HTTP layer translates into a response with a
 * status code and a machine-readable `code`.
 *
 * `name` is set to the concrete subclass name.
 */
export class AppError extends Error {
  /**
   * @param message - Client-safe message.
   * @param statusCode - HTTP status to respond with.
   * @param code - Stable machine-readable error code.
   */
  constructor(
    override readonly message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message)
    this.name = new.target.name
  }
}

/** The requested resource does not exist (or is not visible to the caller). HTTP 404, code `not_found`. */
export class NotFoundError extends AppError {
  /** @param what - Noun for the message, producing "`<what>` not found." */
  constructor(what = 'Resource') {
    super(`${what} not found.`, 404, 'not_found')
  }
}

/** The request conflicts with current state, such as a duplicate or a referenced row. HTTP 409. */
export class ConflictError extends AppError {
  /**
   * @param message - Client-safe explanation.
   * @param code - Machine-readable code; defaults to `conflict`.
   */
  constructor(message: string, code = 'conflict') {
    super(message, 409, code)
  }
}

/** The request was well-formed but invalid. HTTP 400, code `validation_failed`. */
export class ValidationError extends AppError {
  /** @param message - Client-safe description of what is invalid. */
  constructor(message: string) {
    super(message, 400, 'validation_failed')
  }
}

/** The caller is not authenticated. HTTP 401, code `unauthorized`. */
export class UnauthorizedError extends AppError {
  /** @param message - Client-safe message; defaults to "Authentication required." */
  constructor(message = 'Authentication required.') {
    super(message, 401, 'unauthorized')
  }
}

/**
 * Whether a driver error is PostgreSQL's unique-violation (23505).
 *
 * Duck-typed on the `code` property so it works with any driver error shape.
 *
 * @param error - Anything thrown by a query.
 * @returns True if `error.code === '23505'`.
 */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}
