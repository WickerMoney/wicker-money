import type { ValidationIssue } from '@wickermoney/ui-kit'

/** An error response from the API, carrying its HTTP status and machine-readable code. */
export class ApiError extends Error {
  constructor(
    message: string,
    /** The HTTP status code of the response. */
    readonly status: number,
    /** The API's error code, or `request_failed` when the body had none. */
    readonly code: string,
    /**
     * The problems field by field, from a `validation_failed` (or a plugin's
     * own 400). Empty when the response had none. Read by `formErrorsFrom`
     * to put each message under its field.
     */
    readonly issues: readonly ValidationIssue[] = [],
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

