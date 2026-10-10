import { Table, type Column } from '@wickermoney/ui-kit'
import { monthLabelLong } from '../helpers/monthLabel.js'
import type { MonthTotal } from '../models/index.js'

/** Props for {@link TrendTable}. */
export interface TrendTableProps {
  /** Every month the chart draws, oldest first. */
  readonly months: readonly MonthTotal[]
  /** The range's name, for the table's accessible label. */
  readonly rangeLabel: string
  /** Formats a decimal-string amount for display. */
  readonly formatMoney: (value: string) => string
}

/**
 * The income/spending chart as a table: one row per month with income,
 * spending and net.
 *
 * The same figures the marks carry, laid out so that nothing depends on a
 * pointer, a focus order or reading one month at a time.
 */
export function TrendTable({ months, rangeLabel, formatMoney }: TrendTableProps) {
  const columns: readonly Column<MonthTotal>[] = [
    { key: 'month', header: 'Month', render: (m) => monthLabelLong(m.month) },
    { key: 'income', header: 'Income', numeric: true, render: (m) => formatMoney(m.income) },
    { key: 'expense', header: 'Spending', numeric: true, render: (m) => formatMoney(m.expense) },
    { key: 'net', header: 'Net', numeric: true, render: (m) => formatMoney(m.net) },
  ]
  return (
    <div role="group" aria-label={`Income and spending per month over ${rangeLabel}, as a table`}>
      <Table columns={columns} rows={months} rowKey={(m) => m.month} />
    </div>
  )
}
