import { ApiError } from '../api/ApiError.js'

/**
 * A `400 validation_failed` as the API client rejects with it.
 *
 * @param issues - The field-level issues, each `[path, message]`.
 * @returns The error, with a top-level message joined the way the API joins it.
 */
export function validationFailed(...issues: readonly [readonly (string | number)[], string][]): ApiError {
  const list = issues.map(([path, message]) => ({ path, message }))
  const message = list.map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ')
  return new ApiError(message, 400, 'validation_failed', list)
}
