import { moneyToUnits } from './moneyToUnits.js'

/**
 * Tests whether two amounts are the same value.
 *
 * Use this instead of `===`: PostgreSQL returns `'-81.2000'` for an amount
 * a CSV or a form wrote as `'-81.20'`, and the strings differ.
 *
 * @param a - First amount, as a decimal string.
 * @param b - Second amount, as a decimal string.
 * @returns `true` when both are the same amount at four decimal places.
 * @throws {RangeError} If either argument is not a decimal with at most four places.
 */
export function equalMoney(a: string, b: string): boolean {
  return moneyToUnits(a) === moneyToUnits(b)
}
