import type { TrendSeries } from '../models/index.js'
import type { CollectedSpending } from './collectSpending.js'
import { formatAmount } from './formatAmount.js'
import { OTHER_ID } from './OTHER_ID.js'

/**
 * Ranks categories by spending and folds everything past `limit` into "Other".
 *
 * Largest first, so the biggest category is the base of every bar and stays
 * there when another is hidden. Ties break on name, so the order does not
 * depend on which row the server happened to send first.
 *
 * The fold is not cosmetic: the palette has a fixed number of validated slots.
 *
 * @param spending - The collected totals.
 * @param limit - How many named categories to keep.
 * @returns At most `limit` named series, then "Other" when any were left over.
 */
export function rankSeries(spending: CollectedSpending, limit: number): TrendSeries[] {
  const ranked = [...spending.totals.entries()]
    .map(([id, total]) => ({ id, total, name: spending.names.get(id) ?? id }))
    .sort((a, b) => {
      if (a.total === b.total) return a.name.localeCompare(b.name)
      // Not `b.total - a.total` narrowed to a number: the difference of two bigints does not fit one.
      return a.total > b.total ? -1 : 1
    })

  const named = ranked.slice(0, limit).map((c) => ({
    id: c.id, name: c.name, total: formatAmount(c.total), folded: false,
  }))
  const rest = ranked.slice(limit)
  if (rest.length === 0) return named

  const restTotal = rest.reduce((sum, c) => sum + c.total, 0n)
  return [...named, { id: OTHER_ID, name: 'Other', total: formatAmount(restTotal), folded: true }]
}
