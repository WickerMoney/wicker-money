import { ZERO_MONEY } from '@wickermoney/plugin-sdk/money'
import { Table, type Column } from '@wickermoney/ui-kit'
import { monthLabelLong } from '../helpers/monthLabelLong.js'
import type { MonthReadout, Trend, TrendMonth, TrendSeries } from '../models/index.js'

/** Props for {@link TrendTable}. */
export interface TrendTableProps {
  /** The chart's data. */
  readonly trend: Trend
  /** The series the chart is showing; hidden categories are left out of the table too. */
  readonly visible: readonly TrendSeries[]
  /** Each month's readout, parallel to `trend.months`, for its total. */
  readonly readouts: readonly MonthReadout[]
  /** The range's name, for the table's accessible label. */
  readonly rangeLabel: string
  /** Formats a decimal-string amount for display. */
  readonly formatMoney: (value: string) => string
}

/**
 * The stacked chart as a table: a row per month, a column per shown category,
 * and the month's total.
 *
 * It follows the category filter exactly as the bars do, so the table and the
 * chart never disagree about what is being shown.
 */
export function TrendTable({ trend, visible, readouts, rangeLabel, formatMoney }: TrendTableProps) {
  const totals = new Map(readouts.map((r) => [r.month, r.total] as const))
  const columns: readonly Column<TrendMonth>[] = [
    { key: 'month', header: 'Month', render: (m) => monthLabelLong(m.month) },
    ...visible.map((s): Column<TrendMonth> => ({
      key: s.id,
      header: s.name,
      numeric: true,
      render: (m) => formatMoney(m.values[s.id] ?? ZERO_MONEY),
    })),
    { key: 'total', header: 'Total', numeric: true, render: (m) => formatMoney(totals.get(m.month) ?? ZERO_MONEY) },
  ]
  return (
    <div role="group" aria-label={`Spending by category, month by month (${rangeLabel}), as a table`}>
      <Table columns={columns} rows={trend.months} rowKey={(m) => m.month} />
    </div>
  )
}
