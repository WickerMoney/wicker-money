import { parseAmount } from './parseAmount.js'

/**
 * @param value - A decimal string.
 * @returns `true` when the amount is below zero. `'-0.0000'` is zero, not negative.
 * @throws {RangeError} If `value` is not a decimal number.
 */
export function isNegativeAmount(value: string): boolean {
  return parseAmount(value) < 0n
}
