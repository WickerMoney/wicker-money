import { moneyToUnits } from './moneyToUnits.js'

/**
 * Orders two amounts by value, for `Array.prototype.sort` and the like.
 *
 * Compares numerically, never as text: `'-81.2000'` equals `'-81.20'`, and
 * `'9'` is less than `'10'`.
 *
 * @param a - First amount, as a decimal string.
 * @param b - Second amount, as a decimal string.
 * @returns `-1` if `a < b`, `1` if `a > b`, otherwise `0`.
 * @throws {RangeError} If either argument is not a decimal with at most four places.
 */
export function compareMoney(a: string, b: string): -1 | 0 | 1 {
  const x = moneyToUnits(a)
  const y = moneyToUnits(b)
  return x < y ? -1 : x > y ? 1 : 0
}
