import { PluginRouteError } from '@wickermoney/plugin-sdk/server'
import type { PluginRouteIssue } from '@wickermoney/plugin-sdk/server'

/**
 * An error a route handler raises on purpose, carrying the HTTP status and
 * machine-readable code the host should answer with.
 *
 * A {@link PluginRouteError} with this plugin's defaults and a field helper.
 */
export class DebtPayoffError extends PluginRouteError {
  /**
   * @param message - Human-readable explanation, safe to show to the user.
   * @param statusCode - HTTP status the host responds with. Defaults to `400`.
   * @param code - Stable machine-readable identifier. Defaults to `debt_payoff_error`.
   * @param issues - The fields the problem is on, so the page can show it there.
   */
  constructor(
    message: string,
    statusCode: number = 400,
    code: string = 'debt_payoff_error',
    issues?: readonly PluginRouteIssue[],
  ) {
    super(message, statusCode, code, issues)
  }

  /**
   * An error about one field of the request, `400` unless told otherwise.
   *
   * @param field - The field.
   * @param message - A sentence about it that does not repeat its name.
   * @param code - The machine-readable code.
   * @param statusCode - The HTTP status; `409` for a conflict with existing data.
   * @returns The error, with `field: message` as its message and one issue.
   */
  static field(field: string, message: string, code: string, statusCode: number = 400): DebtPayoffError {
    return new DebtPayoffError(`${field}: ${message}`, statusCode, code, [{ path: [field], message }])
  }

  /** A `404` for a debt the caller does not have, which includes another user's. */
  static debtNotFound(): DebtPayoffError {
    return new DebtPayoffError('That debt was not found.', 404, 'not_found')
  }
}
