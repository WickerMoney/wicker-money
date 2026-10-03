import { moneyToUnits } from './moneyToUnits.js'

/**
 * Tests whether an amount is exactly zero.
 *
 * @param value - A decimal string.
 * @returns `true` for any spelling of zero (`'0'`, `'0.00'`, `'-0.0000'`).
 * @throws {RangeError} If `value` is not a decimal with at most four places.
 */
export function isZeroMoney(value: string): boolean {
  return moneyToUnits(value) === 0n
}
