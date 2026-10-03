import { moneyToUnits } from '@wickermoney/plugin-sdk/money'

/**
 * `spent / planned`, as a float, for progress bars only.
 *
 * The one place budgets turns money into a `number`: a bar is pixels, a
 * rounding error in it is invisible, and nothing downstream of it is money.
 *
 * A zero plan has no meaningful ratio. Returning 0 would draw an empty bar for
 * a category that has been overspent against a plan of nothing, which is the
 * opposite of the truth, so a zero plan with any spend is reported as fully
 * over.
 *
 * @param spent - Amount spent, as a decimal string.
 * @param planned - Amount planned, as a decimal string.
 * @returns `spent / planned`; `0` when both are zero, `1` when only the plan is zero.
 * @throws {RangeError} If either argument is not a decimal with at most four places.
 */
export function ratio(spent: string, planned: string): number {
  const p = moneyToUnits(planned)
  const s = moneyToUnits(spent)
  if (p === 0n) return s === 0n ? 0 : 1
  return Number(s) / Number(p)
}
