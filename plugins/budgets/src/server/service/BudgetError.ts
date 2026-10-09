import { PluginRouteError } from '@wickermoney/plugin-sdk/server'
import type { PluginRouteIssue } from '@wickermoney/plugin-sdk/server'

/**
 * An error a route handler raises on purpose, carrying the HTTP status and
 * machine-readable code the host should answer with.
 *
 * A {@link PluginRouteError} with this plugin's defaults and a field helper.
 */
export class BudgetError extends PluginRouteError {
  /**
   * @param message - Human-readable explanation, safe to show to the user.
   * @param statusCode - HTTP status the host responds with. Defaults to `400`.
   * @param code - Stable machine-readable identifier. Defaults to `budget_error`.
   * @param issues - The field the problem is on, so the page can show it there.
   */
  constructor(
    message: string,
    statusCode: number = 400,
    code: string = 'budget_error',
    issues?: readonly PluginRouteIssue[],
  ) {
    super(message, statusCode, code, issues)
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
