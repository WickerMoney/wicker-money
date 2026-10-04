/**
 * One thing wrong with a request, tied to the input it came from.
 *
 * `path` names the field the way the request body does (`['conditions', 0,
 * 'amountMin']`), so a form can put `message` next to the box the user typed
 * in. An empty `path` means the problem is with the request as a whole, not
 * one field. `message` is a sentence about that field, written for the person
 * who filled it in; it never repeats the path.
 */
export interface ValidationIssue {
  /** Where in the request the problem is; `[]` for the request as a whole. */
  readonly path: readonly (string | number)[]
  /** What is wrong, as a sentence. */
  readonly message: string
}

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
   * @param issues - Field-level detail, sent as `issues` when present.
   */
  constructor(
    override readonly message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly issues?: readonly ValidationIssue[],
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

/**
 * A leading `field: ` on a message, as service-level errors have always been
 * written (`'endDate: Must be on or after the first date.'`). Lower-case
 * first letter, dotted segments, no spaces, so ordinary prose with a colon in
 * it is never mistaken for a path.
 */
const FIELD_PREFIX = /^([a-z]\w*(?:\.\w+)*): (.+)$/s

/**
 * Splits a `field: sentence` message into a single issue.
 *
 * @param message - The error's message.
 * @returns One issue: the path and sentence when the message starts with a
 *   field, otherwise an empty path and the whole message.
 */
function issueFromMessage(message: string): ValidationIssue {
  const match = FIELD_PREFIX.exec(message)
  if (match === null) return { path: [], message }
  const path = (match[1] as string).split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p))
  return { path, message: match[2] as string }
}

/**
 * The request was well-formed but invalid. HTTP 400, code `validation_failed`.
 *
 * Always carries at least one {@link ValidationIssue}, so a client can read
 * `issues` without first checking whether it is there. Without explicit
 * issues, a message written `field: sentence` (`'to: Must be on or after the
 * start of the range.'`, `'legs.0.amount: Must be more than 0.'`) becomes one
 * issue for that field; any other message becomes one issue with an empty
 * path. Either way the top-level message is exactly what was passed, so
 * clients that only read `message` see no change.
 */
export class ValidationError extends AppError {
  /** Every problem found, each tied to its field where there is one. Never empty. */
  declare readonly issues: readonly ValidationIssue[]

  /**
   * @param message - Client-safe description of what is invalid.
   * @param issues - The problems field by field. Defaults to one issue read
   *   from `message`, as described on the class.
   */
  constructor(message: string, issues?: readonly ValidationIssue[]) {
    super(message, 400, 'validation_failed', issues !== undefined && issues.length > 0 ? issues : [issueFromMessage(message)])
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
