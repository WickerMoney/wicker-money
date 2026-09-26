import { AppError } from '../../../errors.js'

/** The error thrown when a client exceeds a rate limit: HTTP 429, code `rate_limited`. */
export function rateLimitedError(): AppError {
  return new AppError('Too many requests. Try again later.', 429, 'rate_limited')
}
