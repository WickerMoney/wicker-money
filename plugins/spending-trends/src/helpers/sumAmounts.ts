import { formatAmount } from './formatAmount.js'
import { parseAmount } from './parseAmount.js'

/**
 * Totals decimal strings exactly.
 *
 * @param values - Decimal strings to add; may be empty.
 * @returns The total as a four-decimal string, `'0.0000'` for an empty list.
 * @throws {RangeError} If any element is not a decimal number.
 */
export function sumAmounts(values: readonly string[]): string {
  return formatAmount(values.reduce((total, v) => total + parseAmount(v), 0n))
}
