import { ImportError } from './ImportError.js'

/**
 * The server is running as many imports as it allows and this one waited its
 * turn without getting one. HTTP `503`, code `import_busy`.
 *
 * Carries `retryAfterSeconds`, which the host sends as `Retry-After`. Nothing
 * was written, so the person (or the page) may send the same request again; a
 * commit repeats safely because it carries an idempotency key.
 */
export class ImportBusyError extends ImportError {
  /**
   * @param retryAfterSeconds - When to try again, in whole seconds.
   * @param waitedSeconds - How long this request waited before giving up.
   */
  constructor(readonly retryAfterSeconds: number, waitedSeconds: number) {
    super(
      waitedSeconds > 0
        ? `Other imports are still running and yours has not started after ${waitedSeconds} seconds. Nothing was imported. Try again in about ${retryAfterSeconds} seconds.`
        : `Other imports are running right now and yours has not started. Nothing was imported. Try again in about ${retryAfterSeconds} seconds.`,
      503,
      'import_busy',
    )
  }
}
