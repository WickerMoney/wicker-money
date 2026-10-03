import { MONEY_SCALE } from './MONEY_SCALE.js'
import { MONEY_UNIT } from './MONEY_UNIT.js'

/**
 * Formats integer units of 0.0001 as a canonical four-decimal string.
 *
 * This is the storage form, not a display form: use the host's
 * `ctx.formatMoney` to show an amount to a person.
 *
 * @param units - An amount scaled by 10,000, as {@link moneyToUnits} returns it.
 * @returns A string such as `'-81.2000'`. Zero is always `'0.0000'`, never `'-0.0000'`.
 * @throws {TypeError} If `units` is not a `bigint`.
 * @example
 * unitsToMoney(-812_000n) // '-81.2000'
 */
export function unitsToMoney(units: bigint): string {
  if (typeof units !== 'bigint') throw new TypeError(`Expected bigint units, got ${typeof units}`)
  const negative = units < 0n
  const absolute = negative ? -units : units
  const fraction = (absolute % MONEY_UNIT).toString().padStart(MONEY_SCALE, '0')
  return `${negative ? '-' : ''}${absolute / MONEY_UNIT}.${fraction}`
}
