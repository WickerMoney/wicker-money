import { MONEY_UNIT } from './MONEY_UNIT.js'
import { moneyToUnits } from './moneyToUnits.js'
import { unitsToMoney } from './unitsToMoney.js'

/**
 * An amount in the shape a person types, for prefilling an input.
 *
 * `numeric(19,4)` round-trips as `'450.0000'`, and putting that in an editable
 * field tells the user the database's business rather than their own; nobody
 * types four decimal places for a grocery budget. Two places are kept because
 * that is what money looks like. Not localized and no currency symbol: use the
 * host's `ctx.formatMoney` for display.
 *
 * @param value - A stored amount, as a decimal string.
 * @returns Two decimals (`'450.00'`), or all four when the amount has real
 *   sub-cent precision (`'0.1250'`), so nothing the user entered is rounded away.
 * @throws {RangeError} If `value` is not a decimal with at most four places.
 */
export function editableMoney(value: string): string {
  const units = moneyToUnits(value)
  if (units % 100n !== 0n) return unitsToMoney(units)
  const negative = units < 0n
  const absolute = negative ? -units : units
  const cents = ((absolute % MONEY_UNIT) / 100n).toString().padStart(2, '0')
  return `${negative ? '-' : ''}${absolute / MONEY_UNIT}.${cents}`
}
