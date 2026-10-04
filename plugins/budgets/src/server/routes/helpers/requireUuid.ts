import { BudgetError } from '../../service/BudgetError.js'
import { UUID_PATTERN } from './UUID_PATTERN.js'

/**
 * Checks that a request value is a category id.
 *
 * @param value - The raw value from the query string or body.
 * @param field - The parameter name, used in the error message.
 * @returns The value, typed as a UUID string.
 * @throws {BudgetError} `400 bad_category` when the value is not a UUID string.
 */
export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw BudgetError.field(field, 'Choose a category.', 'bad_category')
  }
  return value
}
