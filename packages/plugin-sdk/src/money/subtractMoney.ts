import { moneyToUnits } from './moneyToUnits.js'
import { unitsToMoney } from './unitsToMoney.js'

/**
 * Subtracts one amount from another exactly.
 *
 * @param a - Amount to subtract from, as a decimal string.
 * @param b - Amount to subtract, as a decimal string.
 * @returns `a - b` as a four-decimal string.
 * @throws {RangeError} If either argument is not a decimal with at most four places.
 */
export function subtractMoney(a: string, b: string): string {
  return unitsToMoney(moneyToUnits(a) - moneyToUnits(b))
}
