import { Button, Surface, Table } from '@wickermoney/ui-kit'
import { formatDate } from '../../../lib/formatDate.js'
import type { RecurringItem } from '../../../models/index.js'
import { describeSchedule } from '../helpers/describeSchedule.js'
import { KIND_LABELS } from '../helpers/labels.js'
import { AmountCell } from './AmountCell.js'
import { LegsCell } from './LegsCell.js'

/** Props for {@link RecurringSection}. */
export interface RecurringSectionProps {
  readonly title: string
  readonly items: readonly RecurringItem[]
  readonly currency: string
  readonly accountName: (id: string) => string
  readonly categoryName: (id: string | null) => string | null
  readonly busy: boolean
  readonly onEdit: (item: RecurringItem) => void
  readonly onEnd: (item: RecurringItem) => void
  readonly onDelete: (item: RecurringItem) => void
}

/**
 * One group of the list: income, bills and debt payments, or transfers.
 *
 * "Next due" is the date the server derived from the schedule and today, never
 * the anchor the series was started from: showing the anchor as "due" is how
 * the old app came to list a year-old date as upcoming.
 */
export function RecurringSection({
  title, items, currency, accountName, categoryName, busy, onEdit, onEnd, onDelete,
}: RecurringSectionProps) {
  if (items.length === 0) return null
  return (
    <Surface title={title}>
      <Table
        columns={[
          { key: 'name', header: 'Name', render: (i: RecurringItem) => (
            <div>
              <div>{i.name}</div>
              <div className="wm-muted recur-sub">
                {i.kind === 'debt_payment' ? KIND_LABELS.debt_payment : categoryName(i.categoryId) ?? ''}
              </div>
            </div>
          ) },
          { key: 'due', header: 'Next due', render: (i: RecurringItem) => (
            <div>
              {i.nextDue === null
                ? <span className="wm-muted">Ended</span>
                : <span className="recur-date">{formatDate(i.nextDue)}</span>}
              <div className="wm-muted recur-sub">{describeSchedule(i)}</div>
            </div>
          ) },
          { key: 'where', header: 'Account', render: (i: RecurringItem) => <LegsCell item={i} accountName={accountName} /> },
          { key: 'amount', header: 'Amount', numeric: true,
            render: (i: RecurringItem) => <AmountCell value={i.amount} kind={i.kind} currency={currency} /> },
          { key: 'month', header: 'Per month', numeric: true,
            render: (i: RecurringItem) => i.frequency === 'once'
              ? <span className="wm-muted">one-off</span>
              : <AmountCell value={i.monthlyEquivalent} kind={i.kind} currency={currency} /> },
          { key: 'actions', header: '', render: (i: RecurringItem) => (
            <div className="recur-actions">
              <Button disabled={busy} onClick={() => onEdit(i)}>Edit</Button>
              {i.nextDue !== null && i.frequency !== 'once'
                ? <Button disabled={busy} onClick={() => onEnd(i)}>End</Button>
                : null}
              <Button variant="danger" disabled={busy} onClick={() => onDelete(i)}>Delete</Button>
            </div>
          ) },
        ]}
        rows={items}
        rowKey={(i) => i.id}
      />
    </Surface>
  )
}
