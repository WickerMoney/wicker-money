/** An error response from the API, carrying its HTTP status and machine-readable code. */
export class ApiError extends Error {
  constructor(
    message: string,
    /** The HTTP status code of the response. */
    readonly status: number,
    /** The API's error code, or `request_failed` when the body had none. */
    readonly code: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
