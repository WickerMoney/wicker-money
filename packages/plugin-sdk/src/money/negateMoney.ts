import { moneyToUnits } from './moneyToUnits.js'
import { unitsToMoney } from './unitsToMoney.js'

/**
 * Flips the sign of an amount.
 *
 * @param value - A decimal string.
 * @returns `-value` as a four-decimal string; zero stays `'0.0000'`.
 * @throws {RangeError} If `value` is not a decimal with at most four places.
 */
export function negateMoney(value: string): string {
  return unitsToMoney(-moneyToUnits(value))
}
