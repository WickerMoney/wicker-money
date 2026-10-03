import { moneyToUnits, unitsToMoney } from '@wickermoney/plugin-sdk/money'
import type { CategoryTotal, SummaryRow } from '../models/index.js'

/**
 * Picks the top categories by spend and folds the remainder into "Other".
 *
 * The fold is not cosmetic: the categorical palette is validated for a fixed
 * number of slots, and inventing a hue for an extra series is exactly what the
 * palette rules forbid. Only spending is counted, since "where it went" is a
 * question about outflow and a salary slice would make the largest wedge the one
 * thing that did not go anywhere.
 *
 * Amounts are summed as exact integers at four decimal places.
 *
 * @param rows - The category rows from the API.
 * @param limit - How many named categories to keep. Defaults to 5.
 * @returns At most `limit` categories in descending order, plus `Other` when
 *   there are more. Totals are four-decimal strings.
 * @throws {RangeError} If a row's total is not a decimal number.
 */
export function topCategories(rows: readonly SummaryRow[], limit = 5): CategoryTotal[] {
  const acc = new Map<string, bigint>()
  for (const r of rows) {
    if (r.kind === 'income') continue
    acc.set(r.categoryName, (acc.get(r.categoryName) ?? 0n) + moneyToUnits(r.total))
  }
  const sorted = [...acc.entries()]
    .map(([name, total]) => ({ name, total }))
    // Not `b - a` narrowed to a number: the difference of two bigints does not fit one.
    .sort((a, b) => (a.total === b.total ? 0 : b.total > a.total ? 1 : -1))
  const shown = (c: { name: string; total: bigint }): CategoryTotal => ({
    name: c.name, total: unitsToMoney(c.total),
  })
  if (sorted.length <= limit) return sorted.map(shown)
  const head = sorted.slice(0, limit).map(shown)
  const rest = sorted.slice(limit).reduce((sum, c) => sum + c.total, 0n)
  return rest > 0n ? [...head, { name: 'Other', total: unitsToMoney(rest) }] : head
}
