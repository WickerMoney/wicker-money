import { Surface, Table } from '@wickermoney/ui-kit'
import type { MonthResponse, Unbudgeted } from '../models/index.js'

/** Props for {@link UnbudgetedPanel}. */
export interface UnbudgetedPanelProps {
  readonly month: MonthResponse
  readonly formatMoney: (value: string) => string
}

/**
 * Lists categories that had spending but no budget line.
 *
 * Without it, a category that was forgotten and a category with nothing spent
 * look identical, since both are simply absent from the lines.
 */
export function UnbudgetedPanel({ month, formatMoney: money }: UnbudgetedPanelProps) {
  return (
    <Surface title="Spent with no budget">
      <p className="bud__note">
        Money left these categories this month and none of them has a line. A category you
        forgot to budget and one you spent nothing in look identical otherwise — both are
        simply absent.
      </p>
      <Table
        columns={[
          { key: 'name', header: 'Category', render: (u: Unbudgeted) => u.categoryName },
          {
            key: 'spent', header: 'Spent', numeric: true,
            render: (u: Unbudgeted) => <span className="bud__num">{money(u.spent)}</span>,
          },
        ]}
        rows={[...month.unbudgeted]}
        rowKey={(u) => u.categoryId}
      />
      <p className="bud__note">
        Total unbudgeted: <strong>{money(month.summary.unbudgetedSpent)}</strong>
      </p>
    </Surface>
  )
}
