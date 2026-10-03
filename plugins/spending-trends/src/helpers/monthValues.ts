import { unitsToMoney } from '@wickermoney/plugin-sdk/money'
import type { TrendSeries } from '../models/index.js'

/**
 * Builds one month's value for every series.
 *
 * Every series gets an entry, zero when it had nothing, and "Other" is the sum
 * of every category that is not a named series, so the stack's total is the
 * month's whole spending whatever was folded.
 *
 * @param entry - The month's net spending per category id, or `undefined` for a month with no rows.
 * @param series - The chart's series.
 * @param namedIds - The ids of the series that are not the fold.
 * @returns Exact four-decimal strings keyed by series id.
 */
export function monthValues(
  entry: ReadonlyMap<string, bigint> | undefined,
  series: readonly TrendSeries[],
  namedIds: ReadonlySet<string>,
): Record<string, string> {
  const month = entry ?? new Map<string, bigint>()
  let other = 0n
  for (const [id, units] of month) {
    if (!namedIds.has(id)) other += units
  }
  const values: Record<string, string> = {}
  for (const s of series) {
    values[s.id] = unitsToMoney(s.folded ? other : (month.get(s.id) ?? 0n))
  }
  return values
}
