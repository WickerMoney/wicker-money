import { useMemo } from 'react'
import { Table, type Column } from '@wickermoney/ui-kit'
import type { PayoffPlan, PlanDebt } from '../../shared/index.js'

/** Props for {@link PayoffOrderTable}. */
export interface PayoffOrderTableProps {
  readonly plan: PayoffPlan
  readonly colors: ReadonlyMap<string, string>
  readonly formatMoney: (value: string) => string
  readonly formatDate: (value: string) => string
}

/**
 * The debts in the order the plan pays them, with when each is cleared and what
 * it costs in interest. It doubles as the chart's key: each row wears the colour
 * of its band, and the name is always beside it.
 */
export function PayoffOrderTable({ plan, colors, formatMoney, formatDate }: PayoffOrderTableProps) {
  const rows = useMemo(() => plan.debts.filter((d) => Number(d.startingBalance) > 0), [plan.debts])
  const columns = useMemo<readonly Column<PlanDebt>[]>(() => [
    { key: 'order', header: '#', numeric: true, render: (d) => String(rows.indexOf(d) + 1) },
    {
      key: 'name',
      header: 'Debt',
      render: (d) => (
        <span className="dp-name">
          <span className="dp-swatch" aria-hidden="true" style={{ background: colors.get(d.id) ?? 'var(--wm-chart-other)' }} />
          {d.name}
        </span>
      ),
    },
    { key: 'balance', header: 'Starts at', numeric: true, render: (d) => formatMoney(d.startingBalance) },
    {
      key: 'payoff',
      header: 'Paid off',
      numeric: true,
      render: (d) => (d.payoffDate === null ? 'Not within the plan' : formatDate(d.payoffDate)),
    },
    { key: 'interest', header: 'Interest', numeric: true, render: (d) => formatMoney(d.totalInterest) },
  ], [rows, colors, formatMoney, formatDate])
  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(d) => d.id}
      className="dp-order"
      caption="Debts in the order the plan pays them"
    />
  )
}
