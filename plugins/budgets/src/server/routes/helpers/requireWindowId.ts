import { isUuid } from '@wickermoney/plugin-sdk/server'
import { BudgetError } from '../../service/BudgetError.js'

/**
 * Checks that a request value is a window id.
 *
 * @param value - The raw value from the query string or body.
 * @returns The value, typed as a UUID string.
 * @throws {BudgetError} `400 bad_id` when the value is not a UUID string.
 */
export function requireWindowId(value: unknown): string {
  if (!isUuid(value)) {
    throw new BudgetError('id must be a window id.', 400, 'bad_id')
  }
  return value
}
