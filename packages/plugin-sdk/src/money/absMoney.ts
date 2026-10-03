import { moneyToUnits } from './moneyToUnits.js'
import { unitsToMoney } from './unitsToMoney.js'

/**
 * The magnitude of an amount.
 *
 * @param value - A decimal string.
 * @returns `|value|` as a four-decimal string.
 * @throws {RangeError} If `value` is not a decimal with at most four places.
 */
export function absMoney(value: string): string {
  const units = moneyToUnits(value)
  return unitsToMoney(units < 0n ? -units : units)
}
