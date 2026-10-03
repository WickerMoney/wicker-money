import { moneyToUnits, unitsToMoney } from '@wickermoney/plugin-sdk/money'
import type { MonthTotal, SummaryRow } from '../models/index.js'

/**
 * Collapses category rows into income and expense per month.
 *
 * Two series rather than one, because "how much did I spend" is only half the
 * question. A month of 4,000 spending is unremarkable on 6,000 of income and a
 * crisis on 3,000, and a chart of spending alone cannot say which.
 *
 * Pass `expected` to stop the chart lying about gaps. The API returns only months
 * that have activity, so data in March and September would otherwise draw two
 * adjacent bars, reading as consecutive months rather than as two points six
 * months apart. A gap is information; closing it over misleads.
 *
 * Amounts are summed as exact integers at four decimal places, so a month of
 * `0.1` and `0.2` totals `0.3000`, and a fifteen-digit figure is not rounded.
 *
 * @param rows - The category rows from the API.
 * @param expected - Every month the range covers, as `YYYY-MM`. When given, the
 *   result has exactly these months, in this order, with zeros for empty ones.
 * @returns One entry per month: oldest first when `expected` is omitted.
 * @throws {RangeError} If a row's total is not a decimal number.
 */
export function totalsByMonth(
  rows: readonly SummaryRow[],
  expected?: readonly string[],
): MonthTotal[] {
  const acc = new Map<string, { income: bigint; expense: bigint }>()
  for (const r of rows) {
    const bucket = acc.get(r.month) ?? { income: 0n, expense: 0n }
    // A row with no `kind` (from an older server) is treated as expense, which
    // keeps the chart honest about what it cannot classify instead of dropping
    // the amount.
    if (r.kind === 'income') bucket.income += moneyToUnits(r.total)
    else bucket.expense += moneyToUnits(r.total)
    acc.set(r.month, bucket)
  }

  const build = (month: string): MonthTotal => {
    const b = acc.get(month) ?? { income: 0n, expense: 0n }
    return {
      month,
      income: unitsToMoney(b.income),
      expense: unitsToMoney(b.expense),
      net: unitsToMoney(b.income - b.expense),
    }
  }

  if (expected !== undefined) return expected.map(build)
  return [...acc.keys()].sort((a, b) => a.localeCompare(b)).map(build)
}
