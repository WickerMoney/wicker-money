/** One problem with a request, tied to the body field it is about; the host passes these on as `issues`. */
export interface BudgetIssue {
  /** The field, as the request body spells it; empty for the request as a whole. */
  readonly path: readonly (string | number)[]
  /** A sentence about that field that does not repeat its name. */
  readonly message: string
}

/**
 * An error a route handler raises on purpose, carrying the HTTP status and
 * machine-readable code the host should answer with.
 */
export class BudgetError extends Error {
  /**
   * @param message - Human-readable explanation, safe to show to the user.
   * @param statusCode - HTTP status the host responds with. Defaults to `400`.
   * @param code - Stable machine-readable identifier. Defaults to `budget_error`.
   * @param issues - The field the problem is on, so the page can show it there.
   */
  constructor(
    message: string,
    readonly statusCode: number = 400,
    readonly code: string = 'budget_error',
    readonly issues?: readonly BudgetIssue[],
  ) {
    super(message)
    this.name = 'BudgetError'
  }

  /**
   * A `400` about one field of the body.
   *
   * @param field - The body field.
   * @param message - A sentence about it.
   * @param code - The machine-readable code.
   * @returns The error, with `field: message` as its message and one issue.
   */
  static field(field: string, message: string, code: string): BudgetError {
    return new BudgetError(`${field}: ${message}`, 400, code, [{ path: [field], message }])
  }
}
