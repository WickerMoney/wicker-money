import { moneyToUnits } from './moneyToUnits.js'
import { unitsToMoney } from './unitsToMoney.js'

/**
 * Rewrites an amount in canonical four-decimal form.
 *
 * Useful before using an amount as a map key or comparing it as text:
 * `'-81.20'`, `' -81.2 '` and `'-81.2000'` all become `'-81.2000'`.
 *
 * @param value - A decimal string.
 * @returns The same amount as a four-decimal string; any zero becomes `'0.0000'`.
 * @throws {RangeError} If `value` is not a decimal with at most four places.
 */
export function normalizeMoney(value: string): string {
  return unitsToMoney(moneyToUnits(value))
}
