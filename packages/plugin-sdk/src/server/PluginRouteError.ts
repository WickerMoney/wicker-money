import type { PluginRouteIssue } from './PluginRouteIssue.js'

/**
 * An error a route handler raises on purpose, for a request the user can
 * correct or retry.
 *
 * The host answers with `statusCode` and `code` and shows `message` to the
 * person, so `message` must be safe to display. Anything a handler throws that
 * is not recognisably one of these is treated as a bug: it is logged and
 * answered with a generic 500.
 *
 * The host recognises the shape (`statusCode` and `code`), not only the
 * class, so an error from a copy of this class bundled into a plugin still
 * works. A plugin may subclass it to add defaults or helpers.
 */
export class PluginRouteError extends Error {
  /**
   * @param message - Human-readable explanation, safe to show to the user.
   * @param statusCode - HTTP status the host responds with.
   * @param code - Stable machine-readable identifier for clients.
   * @param issues - Field-level detail, so a form can show each problem by its field.
   */
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly issues?: readonly PluginRouteIssue[],
  ) {
    super(message)
    this.name = new.target.name
  }
}
