import { formatAmount } from './formatAmount.js'
import { parseAmount } from './parseAmount.js'

/**
 * Subtracts one decimal string from another exactly.
 *
 * @param a - The amount to subtract from.
 * @param b - The amount to subtract.
 * @returns `a - b` as a four-decimal string.
 * @throws {RangeError} If either argument is not a decimal number.
 */
export function subtractAmounts(a: string, b: string): string {
  return formatAmount(parseAmount(a) - parseAmount(b))
}
