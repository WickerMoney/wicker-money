import { moneyToUnits } from './moneyToUnits.js'
import { unitsToMoney } from './unitsToMoney.js'

/**
 * Totals a list of amounts exactly.
 *
 * @param values - Decimal strings to add; may be empty.
 * @returns The total as a four-decimal string, `'0.0000'` for an empty list.
 * @throws {RangeError} If any element is not a decimal with at most four places.
 */
export function sumMoney(values: readonly string[]): string {
  return unitsToMoney(values.reduce((total, v) => total + moneyToUnits(v), 0n))
}
