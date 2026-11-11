import { ImportError } from '../service/ImportError.js'

/**
 * The one answer for an upload id the caller may not use: never issued, issued
 * to another user, expired, or already imported. The cases look alike on
 * purpose, so a caller cannot tell another user's live id from a dead one.
 *
 * @returns A `404` (`upload_not_found`).
 */
export function uploadNotFound(): ImportError {
  return new ImportError('That upload is not available. It may have expired. Choose the file again.', 404, 'upload_not_found')
}

/**
 * A user already holds the most live uploads allowed.
 *
 * @param limit - The per-user limit.
 * @returns A `409` (`too_many_uploads`).
 */
export function tooManyUploads(limit: number): ImportError {
  return new ImportError(
    `You already have ${limit} uploads waiting. Import or wait for one to expire, then try again.`,
    409,
    'too_many_uploads',
  )
}

/**
 * The process holds as much staged text as it allows.
 *
 * @param retryAfterSeconds - When to try again.
 * @returns A `503` (`staging_full`) that the host sends with `Retry-After`.
 */
export function stagingFull(retryAfterSeconds: number): ImportError & { readonly retryAfterSeconds: number } {
  return Object.assign(
    new ImportError(
      `Other uploads are using all the space for staged files right now. Try again in about ${retryAfterSeconds} seconds.`,
      503,
      'staging_full',
    ),
    { retryAfterSeconds },
  )
}
