import type { SummaryRow } from '../models/index.js'
import { parseAmount } from './parseAmount.js'
import { UNCATEGORIZED_ID } from './UNCATEGORIZED_ID.js'

/** Spending gathered from summary rows, before any ranking. All amounts are exact `bigint` units. */
export interface CollectedSpending {
  /** Display name per category id. */
  readonly names: ReadonlyMap<string, string>
  /** Net spending per category id across every row. */
  readonly totals: ReadonlyMap<string, bigint>
  /** Net spending per month, per category id. */
  readonly byMonth: ReadonlyMap<string, ReadonlyMap<string, bigint>>
}

/**
 * Sums the expense rows by category and by month.
 *
 * Income rows are skipped: this is a chart of where money went. A row with no
 * `kind`, from an older server, is kept as spending, which is honest about what
 * it cannot classify instead of dropping the amount.
 *
 * Refunds are kept as the negative amounts they are. A category whose refunds
 * outweighed its spending in a month has a negative total there, and clamping it
 * to zero would make the chart disagree with the ledger.
 *
 * @param rows - The category rows from the API.
 * @returns The per-category and per-month totals.
 * @throws {RangeError} If a row's total is not a decimal number.
 */
export function collectSpending(rows: readonly SummaryRow[]): CollectedSpending {
  const names = new Map<string, string>()
  const totals = new Map<string, bigint>()
  const byMonth = new Map<string, Map<string, bigint>>()
  for (const row of rows) {
    if (row.kind === 'income') continue
    const id = row.categoryId ?? UNCATEGORIZED_ID
    const units = parseAmount(row.total)
    names.set(id, row.categoryName)
    totals.set(id, (totals.get(id) ?? 0n) + units)
    const month = byMonth.get(row.month) ?? new Map<string, bigint>()
    month.set(id, (month.get(id) ?? 0n) + units)
    byMonth.set(row.month, month)
  }
  return { names, totals, byMonth }
}
