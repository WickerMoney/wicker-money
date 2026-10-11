import { useMemo, useState } from 'react'
import { Button, Table, type Column } from '@wickermoney/ui-kit'
import type { PayoffPlan, PlanMonth } from '../../shared/index.js'

/** Props for {@link ScheduleTable}. */
export interface ScheduleTableProps {
  readonly plan: PayoffPlan
  readonly formatMoney: (value: string) => string
  readonly formatDate: (value: string) => string
}

const PAGE = 24

/**
 * The plan month by month, as a table: what is paid, how much of it is
 * interest, what is left, and which debts are cleared that month.
 *
 * A plan can run to 600 months, so the table shows two years at a time and
 * says how many more there are; the whole schedule is one button away rather
 * than 600 rows the reader has to cross.
 */
export function ScheduleTable({ plan, formatMoney, formatDate }: ScheduleTableProps) {
  const [shown, setShown] = useState(PAGE)
  const total = plan.schedule.length
  const rows = useMemo(() => plan.schedule.slice(0, shown), [plan.schedule, shown])
  const cleared = useMemo(() => {
    const byMonth = new Map<number, string[]>()
    for (const d of plan.debts) {
      if (d.payoffMonth === null || d.payoffMonth === 0) continue
      byMonth.set(d.payoffMonth, [...(byMonth.get(d.payoffMonth) ?? []), d.name])
    }
    return byMonth
  }, [plan.debts])

  const columns = useMemo<readonly Column<PlanMonth>[]>(() => [
    { key: 'month', header: 'Month', numeric: true, render: (m) => String(m.month) },
    { key: 'date', header: 'Date', render: (m) => formatDate(m.date) },
    { key: 'payment', header: 'Paid', numeric: true, render: (m) => formatMoney(m.payment) },
    { key: 'interest', header: 'Interest added', numeric: true, render: (m) => formatMoney(m.interest) },
    { key: 'balance', header: 'Still owed', numeric: true, render: (m) => formatMoney(m.balance) },
    { key: 'cleared', header: 'Paid off', render: (m) => (cleared.get(m.month) ?? []).join(', ') },
  ], [cleared, formatMoney, formatDate])

  return (
    <div className="dp-schedule">
      <Table
        columns={columns}
        rows={rows}
        rowKey={(m) => String(m.month)}
        className="dp-schedule__table"
        caption="The payoff plan, month by month"
      />
      <div className="dp-schedule__more">
        <span className="dp-muted" role="status">Showing {rows.length} of {total} months.</span>
        {shown < total ? (
          <>
            <Button onClick={() => setShown((n) => n + PAGE)}>Show 24 more</Button>
            <Button onClick={() => setShown(total)}>Show all {total}</Button>
          </>
        ) : null}
      </div>
    </div>
  )
}
