import type { MonthReadout, ReadoutRow, TrendMonth, TrendSeries } from '../models/index.js'
import { monthLabelLong } from './monthLabelLong.js'
import { sumAmounts } from './sumAmounts.js'
import { ZERO_AMOUNT } from './ZERO_AMOUNT.js'

/**
 * Reads one month back as words: which categories spent what, and the total.
 *
 * The total is over the categories currently shown, so hiding a category
 * changes it and the tooltip never disagrees with the bar it sits above.
 *
 * @param month - The month.
 * @param visible - The series currently shown, in rank order.
 * @param colors - Each series' colour by id.
 * @param formatMoney - Formats a decimal string as money.
 * @returns The rows top-of-stack first, the total, and a one-sentence description.
 */
export function readMonth(
  month: TrendMonth,
  visible: readonly TrendSeries[],
  colors: ReadonlyMap<string, string>,
  formatMoney: (value: string) => string,
): MonthReadout {
  const rows: ReadoutRow[] = []
  for (const s of visible) {
    const value = month.values[s.id] ?? ZERO_AMOUNT
    if (value === ZERO_AMOUNT) continue
    rows.push({ id: s.id, name: s.name, color: colors.get(s.id) ?? 'currentColor', value })
  }
  // The tooltip reads top of the bar first, like the bar itself.
  rows.reverse()

  const total = sumAmounts(rows.map((r) => r.value))
  const parts = rows.map((r) => `${r.name} ${formatMoney(r.value)}`)
  const detail = parts.length === 0 ? 'no spending' : `${parts.join(', ')}; total ${formatMoney(total)}`
  return { month: month.month, rows, total, description: `${monthLabelLong(month.month)}: ${detail}` }
}
