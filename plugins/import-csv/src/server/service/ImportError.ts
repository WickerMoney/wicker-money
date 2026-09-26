/**
 * An error a route handler raises for a request the user can correct or retry.
 *
 * Carries the HTTP status and a stable machine-readable code so the host can
 * turn it into a response without inspecting the message.
 */
export class ImportError extends Error {
  /**
   * @param message - Human-readable explanation shown to the user.
   * @param statusCode - HTTP status the host should respond with. Defaults to `400`.
   * @param code - Stable error code for clients. Defaults to `import_failed`.
   */
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = 'import_failed',
  ) {
    super(message)
    this.name = 'ImportError'
  }
}
