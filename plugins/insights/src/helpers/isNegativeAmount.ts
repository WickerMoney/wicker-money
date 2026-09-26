import { parseAmount } from './parseAmount.js'

/**
 * @param value - A decimal string.
 * @returns `true` if the amount is strictly below zero at four decimal places.
 * @throws {RangeError} If `value` is not a decimal number.
 */
export function isNegativeAmount(value: string): boolean {
  return parseAmount(value) < 0n
}
