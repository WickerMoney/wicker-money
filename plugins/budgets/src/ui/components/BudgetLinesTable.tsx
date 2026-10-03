import { EmptyState, Table } from '@wickermoney/ui-kit'
import type { MonthLine, MonthResponse } from '../models/index.js'
import { CategoryCell } from './CategoryCell.js'
import { HealthDot } from './HealthDot.js'
import { PaceCell } from './PaceCell.js'
import { PlannedCell } from './PlannedCell.js'
import { RemoveCell } from './RemoveCell.js'
import { RolloverCell } from './RolloverCell.js'

/** Props for {@link BudgetLinesTable}. */
export interface BudgetLinesTableProps {
  readonly month: MonthResponse
  /** Plans being typed and not yet saved, keyed by category id. */
  readonly edits: Readonly<Record<string, string>>
  readonly busy: boolean
  readonly formatMoney: (value: string) => string
  /** Formats a `YYYY-MM-DD` date for display. */
  readonly formatDate: (value: string) => string
  /** Records what the user is typing in a line's plan field. */
  readonly onEditPlan: (categoryId: string, value: string) => void
  /** Saves a line's plan and rollover setting. */
  readonly onSave: (line: MonthLine, planned: string, rollover: boolean) => void
  readonly onRemove: (line: MonthLine) => void
  /** Opens a window in the window form. */
  readonly onEditWindow: (line: MonthLine) => void
}

/**
 * The month's budget lines as an editable table: plan, spend, what is left, a
 * pace bar, a status and the rollover setting.
 */
export function BudgetLinesTable({
  month, edits, busy, formatMoney: money, formatDate, onEditPlan, onSave, onRemove, onEditWindow,
}: BudgetLinesTableProps) {
  if (month.lines.length === 0) {
    return (
      <EmptyState
        title="Nothing budgeted yet"
        hint="Add a category below. Next month will start from whatever you set here."
      />
    )
  }

  return (
    <Table
      columns={[
        {
          key: 'name',
          header: 'Category',
          render: (l: MonthLine) => <CategoryCell line={l} formatMoney={money} formatDate={formatDate} />,
        },
        {
          key: 'planned',
          header: 'Planned',
          numeric: true,
          render: (l: MonthLine) => (
            <PlannedCell line={l} draftValue={edits[l.categoryId]} onEditPlan={onEditPlan} onSave={onSave} />
          ),
        },
        {
          key: 'spent',
          header: 'Spent',
          numeric: true,
          render: (l: MonthLine) => <span className="bud__num">{money(l.spent)}</span>,
        },
        {
          key: 'left',
          header: 'Left',
          numeric: true,
          render: (l: MonthLine) => <span className="bud__num">{money(l.remaining)}</span>,
        },
        {
          key: 'bar',
          header: 'Pace',
          render: (l: MonthLine) => (
            <PaceCell line={l} monthKey={month.monthKey} today={month.today} formatMoney={money} />
          ),
        },
        {
          key: 'health',
          header: 'Status',
          render: (l: MonthLine) => <HealthDot health={l.health} />,
        },
        {
          key: 'rollover',
          header: 'Rolls over',
          render: (l: MonthLine) => (
            <RolloverCell line={l} draftValue={edits[l.categoryId]} busy={busy} onSave={onSave} />
          ),
        },
        {
          key: 'del',
          header: '',
          render: (l: MonthLine) => <RemoveCell line={l} busy={busy} onRemove={onRemove} onEdit={onEditWindow} />,
        },
      ]}
      rows={[...month.lines]}
      // A category can have two windows in one month (one ending, the next
      // starting), so a stored line is keyed by its id.
      rowKey={(l) => l.id ?? l.categoryId}
    />
  )
}
