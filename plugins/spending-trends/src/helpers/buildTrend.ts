import type { SummaryRow, Trend } from '../models/index.js'
import { collectSpending } from './collectSpending.js'
import { monthValues } from './monthValues.js'
import { rankSeries } from './rankSeries.js'
import { SERIES_COLORS } from './SERIES_COLORS.js'

/** Options for {@link buildTrend}. */
export interface BuildTrendOptions {
  /** How many categories to name before folding the rest into "Other". Defaults to the palette size. */
  readonly limit?: number
  /**
   * Every month the range covers, as `YYYY-MM`. When given, the result has
   * exactly these months in this order, with zeros for empty ones.
   */
  readonly expected?: readonly string[]
}

/**
 * Turns the monthly-summary rows into the stacked chart's data: spending per
 * category per month, with the smaller categories folded into "Other".
 *
 * Pass `expected` to stop the chart lying about gaps. The API returns only
 * months that have activity, so data in March and September would otherwise draw
 * two adjacent bars, reading as consecutive months rather than as two points six
 * months apart. A gap is information; closing it over misleads.
 *
 * Amounts are summed as exact integers at four decimal places.
 *
 * @param rows - The category rows from the API.
 * @param options - The category limit and the months to fill.
 * @returns The series, largest first, and one entry per month, oldest first.
 * @throws {RangeError} If a row's total is not a decimal number.
 */
export function buildTrend(rows: readonly SummaryRow[], options: BuildTrendOptions = {}): Trend {
  const { limit = SERIES_COLORS.length, expected } = options
  const spending = collectSpending(rows)
  const series = rankSeries(spending, limit)
  const namedIds = new Set(series.filter((s) => !s.folded).map((s) => s.id))
  const months = expected ?? [...spending.byMonth.keys()].sort((a, b) => a.localeCompare(b))
  return {
    series,
    months: months.map((month) => ({
      month,
      values: monthValues(spending.byMonth.get(month), series, namedIds),
    })),
  }
}
