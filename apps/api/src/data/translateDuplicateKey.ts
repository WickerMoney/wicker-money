import { isUniqueViolation } from '../errors.js'
import { DuplicateKeyError } from './DuplicateKeyError.js'

/**
 * Runs a write and converts a unique-violation into a {@link DuplicateKeyError}.
 *
 * Use it around the single statement that can violate the constraint, not around
 * a whole unit of work: inside a PostgreSQL transaction a failed statement aborts
 * the transaction, so the caller must let the error propagate and roll back.
 *
 * @param write - The statement to run.
 * @returns Whatever `write` resolves to.
 * @throws {DuplicateKeyError} On a unique violation; any other error is rethrown unchanged.
 */
export async function translateDuplicateKey<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateKeyError((error as { constraint?: string }).constraint, error)
    }
    throw error
  }
}
