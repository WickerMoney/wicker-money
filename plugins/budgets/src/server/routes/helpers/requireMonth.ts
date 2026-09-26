import { isMonthKey } from '../../../shared/index.js'
import { BudgetError } from '../../service/BudgetError.js'

/**
 * Checks that a request value is a month key.
 *
 * @param value - The raw value from the query string or body.
 * @returns The value, typed as a `YYYY-MM` string.
 * @throws {BudgetError} `400 bad_month` when the value is not a `YYYY-MM` string.
 */
export function requireMonth(value: unknown): string {
  if (typeof value !== 'string' || !isMonthKey(value)) {
    throw new BudgetError(
      `Expected a month as YYYY-MM, got ${JSON.stringify(value)}.`,
      400,
      'bad_month',
    )
  }
  return value
}
