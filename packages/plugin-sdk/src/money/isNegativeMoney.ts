import { moneyToUnits } from './moneyToUnits.js'

/**
 * Tests whether an amount is below zero.
 *
 * @param value - A decimal string.
 * @returns `true` if `value` is strictly negative. `'-0.0000'` is zero, not negative.
 * @throws {RangeError} If `value` is not a decimal with at most four places.
 */
export function isNegativeMoney(value: string): boolean {
  return moneyToUnits(value) < 0n
}
