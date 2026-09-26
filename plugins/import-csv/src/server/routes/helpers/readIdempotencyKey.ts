import { ImportError } from '../../service/ImportError.js'
import { MAX_IDEMPOTENCY_KEY_LENGTH } from './MAX_IDEMPOTENCY_KEY_LENGTH.js'

/**
 * Validates the optional idempotency key of a commit request.
 *
 * @param value - The unvalidated `idempotencyKey` field.
 * @returns The key, or `undefined` when the request did not send one.
 * @throws {ImportError} `400` (`invalid_idempotency_key`) when the value is not a
 *   string of 1 to 128 characters.
 */
export function readIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new ImportError(
      `idempotencyKey must be a string of 1 to ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
      400,
      'invalid_idempotency_key',
    )
  }
  return value
}
