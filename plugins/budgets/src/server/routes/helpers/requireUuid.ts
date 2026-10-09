import { isUuid } from '@wickermoney/plugin-sdk/server'
import { BudgetError } from '../../service/BudgetError.js'

/**
 * Checks that a request value is an id (a category's unless told otherwise).
 *
 * @param value - The raw value from the query string or body.
 * @param field - The parameter name, used in the error message.
 * @param message - What to tell the user when it is not an id.
 * @param code - The machine-readable code for that failure.
 * @returns The value, typed as a UUID string.
 * @throws {BudgetError} `400` with `code` (default `bad_category`) when the value is not a UUID string.
 */
export function requireUuid(
  value: unknown,
  field: string,
  message = 'Choose a category.',
  code = 'bad_category',
): string {
  if (!isUuid(value)) {
    throw BudgetError.field(field, message, code)
  }
  return value
}
