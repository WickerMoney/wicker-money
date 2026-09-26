import { IDEMPOTENCY_KEY_INDEX } from './IDEMPOTENCY_KEY_INDEX.js'

/**
 * Tells whether a database error is the unique violation raised when a second
 * batch is recorded under an idempotency key that already has one.
 *
 * @param error - Anything thrown while writing a batch.
 * @returns True for a PostgreSQL unique violation (`23505`) on the idempotency-key index.
 */
export function isIdempotencyKeyConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { code, constraint } = error as { code?: unknown; constraint?: unknown }
  return code === '23505' && constraint === IDEMPOTENCY_KEY_INDEX
}
