/**
 * An error a route handler raises on purpose, carrying the HTTP status and
 * machine-readable code the host should answer with.
 */
export class BudgetError extends Error {
  /**
   * @param message - Human-readable explanation, safe to show to the user.
   * @param statusCode - HTTP status the host responds with. Defaults to `400`.
   * @param code - Stable machine-readable identifier. Defaults to `budget_error`.
   */
  constructor(
    message: string,
    readonly statusCode: number = 400,
    readonly code: string = 'budget_error',
  ) {
    super(message)
    this.name = 'BudgetError'
  }
}
