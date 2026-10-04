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
    readonly issues?: readonly { readonly path: readonly (string | number)[]; readonly message: string }[],
  ) {
    super(message)
    this.name = 'ImportError'
  }

  /**
   * A `400` about one field of the body, which the host passes on as
   * `issues` so the page can show it under that field.
   *
   * @param path - The field, as the request body spells it.
   * @param message - A sentence about it.
   * @returns The error, with `path: message` as its message.
   */
  static field(path: readonly string[], message: string): ImportError {
    return new ImportError(`${path.join('.')}: ${message}`, 400, 'import_failed', [{ path, message }])
  }
}
