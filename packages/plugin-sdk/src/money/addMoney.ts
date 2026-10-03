import { moneyToUnits } from './moneyToUnits.js'
import { unitsToMoney } from './unitsToMoney.js'

/**
 * Adds two amounts exactly.
 *
 * @param a - First amount, as a decimal string.
 * @param b - Second amount, as a decimal string.
 * @returns `a + b` as a four-decimal string.
 * @throws {RangeError} If either argument is not a decimal with at most four places.
 * @example
 * addMoney('0.1', '0.2') // '0.3000'
 */
export function addMoney(a: string, b: string): string {
  return unitsToMoney(moneyToUnits(a) + moneyToUnits(b))
}
